// Proximity voice chat: WebRTC audio between every pair of players who've switched it on, signalled through party
// messages (no server of ours involved). Each voice comes out of where that player is standing, quieter with
// distance and muffled through walls and floors; at a meeting everyone's at full volume; the living never hear
// ghosts (the honour rule). Without a TURN server some networks can't connect: the game tells you who you can't hear.

import type { Vec3 } from '../../shared/math.ts';

export type VoiceKind = 'hi' | 'offer' | 'answer' | 'ice' | 'bye';
export const VOICE_KINDS: VoiceKind[] = ['hi', 'offer', 'answer', 'ice', 'bye'];

export interface VoiceMsg {
  t: 'vc';
  k: VoiceKind;
  d: string;
}

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

interface Peer {
  pc: RTCPeerConnection;
  el?: HTMLAudioElement;
  gain?: GainNode;
  lp?: BiquadFilterNode;
  panner?: PannerNode;
  meter?: AnalyserNode;
  level: number;
}

/** How loud someone is, from where they are (0..1); `muffle` 0 clear, 1 a wall, 2 a floor. Pure. */
export function voiceGain(dist: number, muffle: 0 | 1 | 2): number {
  const near = Math.max(0, Math.min(1, 1 - (dist - 1.5) / 14));
  return near * (muffle === 2 ? 0.3 : muffle === 1 ? 0.55 : 1);
}

export class Voice {
  private peers = new Map<number, Peer>();
  private local: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  on = false;
  muted = false;
  private meterBuf = new Float32Array(256);

  constructor(
    private me: number,
    private send: (m: VoiceMsg, to?: number) => void,
  ) {}

  /** Switches voice on (asks for the mic). Returns an error to show, or null. */
  async start(): Promise<string | null> {
    if (this.on) return null;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return 'No microphone (or you said no). Voice is off.';
    }
    this.ctx = new AudioContext();
    this.on = true;
    this.send({ t: 'vc', k: 'hi', d: '' });
    return null;
  }

  stop() {
    if (!this.on) return;
    this.send({ t: 'vc', k: 'bye', d: '' });
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    void this.ctx?.close();
    this.ctx = null;
    this.on = false;
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !m));
  }

  /** Who we're hearing (connected), for the HUD. */
  get connected(): number[] {
    return [...this.peers].filter(([, p]) => p.pc.connectionState === 'connected').map(([id]) => id);
  }

  async handle(from: number, m: VoiceMsg) {
    if (!this.on || from === this.me) return;
    try {
      switch (m.k) {
        case 'hi':
          // The lower id calls; the higher one says hi back so the lower one knows to.
          if (this.peers.has(from)) return;
          if (this.me < from) await this.call(from);
          else this.send({ t: 'vc', k: 'hi', d: '' }, from);
          return;
        case 'offer': {
          const p = this.peer(from);
          await p.pc.setRemoteDescription(JSON.parse(m.d));
          const answer = await p.pc.createAnswer();
          await p.pc.setLocalDescription(answer);
          this.send({ t: 'vc', k: 'answer', d: JSON.stringify(p.pc.localDescription) }, from);
          return;
        }
        case 'answer':
          await this.peers.get(from)?.pc.setRemoteDescription(JSON.parse(m.d));
          return;
        case 'ice':
          await this.peers.get(from)?.pc.addIceCandidate(JSON.parse(m.d));
          return;
        case 'bye':
          this.drop(from);
          return;
      }
    } catch {
      /* a bad or out-of-order message: that pair just won't connect */
    }
  }

  private async call(id: number) {
    const p = this.peer(id);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.send({ t: 'vc', k: 'offer', d: JSON.stringify(p.pc.localDescription) }, id);
  }

  private peer(id: number): Peer {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p = { pc, level: 0 };
    this.peers.set(id, p);
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    pc.onicecandidate = (e) => e.candidate && this.send({ t: 'vc', k: 'ice', d: JSON.stringify(e.candidate) }, id);
    pc.ontrack = (e) => this.attach(id, e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => pc.connectionState === 'failed' && this.drop(id);
    return p;
  }

  /** A remote voice into WebAudio: gain → muffle → position. (Chrome wants the stream on a muted element too.) */
  private attach(id: number, stream: MediaStream) {
    const p = this.peers.get(id);
    const ctx = this.ctx;
    if (!p || !ctx || p.gain) return;
    p.el = new Audio();
    p.el.muted = true;
    p.el.srcObject = stream;
    void p.el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    p.meter = ctx.createAnalyser();
    p.meter.fftSize = 256;
    p.gain = ctx.createGain();
    p.lp = ctx.createBiquadFilter();
    p.lp.type = 'lowpass';
    p.panner = ctx.createPanner();
    p.panner.panningModel = 'HRTF';
    p.panner.distanceModel = 'linear';
    p.panner.refDistance = 1;
    p.panner.maxDistance = 1000;
    p.panner.rolloffFactor = 0;
    src.connect(p.meter);
    src.connect(p.gain).connect(p.lp).connect(p.panner).connect(ctx.destination);
  }

  private drop(id: number) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.gain?.disconnect();
    if (p.el) p.el.srcObject = null;
    this.peers.delete(id);
  }

  /**
   * Per frame: where you are, and for each peer where they are and how loud they should be (0..1) and how muffled.
   * Returns who's talking right now.
   */
  update(me: Vec3, yaw: number, peers: Map<number, { at: Vec3; gain: number; muffle: 0 | 1 | 2 }>): Set<number> {
    const ctx = this.ctx;
    const talking = new Set<number>();
    if (!ctx) return talking;
    if (ctx.state === 'suspended') void ctx.resume();
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = me.x;
      l.positionY.value = me.y;
      l.positionZ.value = me.z;
      l.forwardX.value = -Math.sin(yaw);
      l.forwardZ.value = -Math.cos(yaw);
      l.forwardY.value = 0;
    }
    for (const [id, p] of this.peers) {
      const v = peers.get(id);
      if (!p.gain || !p.lp || !p.panner) continue;
      const t = ctx.currentTime;
      p.gain.gain.setTargetAtTime(v ? v.gain : 0, t, 0.1);
      p.lp.frequency.setTargetAtTime(v?.muffle === 2 ? 400 : v?.muffle === 1 ? 1200 : 12000, t, 0.1);
      if (v) {
        p.panner.positionX.value = v.at.x;
        p.panner.positionY.value = v.at.y;
        p.panner.positionZ.value = v.at.z;
      }
      if (p.meter) {
        p.meter.getFloatTimeDomainData(this.meterBuf);
        let sum = 0;
        for (const s of this.meterBuf) sum += s * s;
        p.level = p.level * 0.8 + Math.sqrt(sum / this.meterBuf.length) * 0.2;
        if (p.level > 0.02 && (v?.gain ?? 0) > 0) talking.add(id);
      }
    }
    return talking;
  }

  dispose() {
    this.stop();
  }
}
