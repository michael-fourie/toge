import * as THREE from 'three';
import type { Gear } from '../../shared/items.ts';
import { JACKETS, type Skin } from '../../shared/skin.ts';
import { Avatar } from '../avatar.ts';
import { studio } from '../render/studio.ts';

export const DEFAULT_JACKET = JACKETS[0];

/**
 * A small WebGL canvas showing the real Avatar turning slowly. `show` swaps the look;
 * `dispose` stops the loop and frees the renderer (call it when the screen is left).
 */
export function mountSkinPreview(canvas: HTMLCanvasElement, turntable = false, swing = 1.1) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  studio(renderer, scene); // keyed from the front-left of the avatar, whose face looks down -Z at yaw 0
  // The avatar faces -Z, so the camera sits on that side to see its face first.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.05, -4.4);
  camera.lookAt(0, 0.92, 0);

  let avatar: Avatar | null = null;
  let raf = 0;
  const t0 = performance.now();

  const resize = () => {
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 340;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    // Swing around gently rather than a full spin, so the face is on show most of the time.
    // (The inventory spins all the way round so you can see what's on your back.)
    avatar?.pose(0, 0, 0, turntable ? t * 0.8 : Math.sin(t * 0.7) * swing, 0, 0, t);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    show(skin: Skin | null, color: number, name: string, gear?: Gear, knife = false) {
      avatar?.dispose();
      avatar = new Avatar(color, name, false, skin, gear);
      avatar.holdKnife(knife);
      avatar.root.traverse((o) => o instanceof THREE.Sprite && (o.visible = false)); // the name tag
      scene.add(avatar.root);
    },
    resize,
    dispose() {
      cancelAnimationFrame(raf);
      avatar?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
