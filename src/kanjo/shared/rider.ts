// Your driver: who sits in your car (or on your bike), stands next to it on the home screen, and lines up with your
// crew in a race lobby. One of four legends (cartoon characters, steampunk crossed with cyberpunk, built in Blender:
// tools/drivers, docs/DRIVERS.md), or your own, made in the creator from the same parts (look.ts,
// docs/DRIVER_CREATOR.md). Free to change any time, like paint. Pure and shared: the garage stores the pick (garage.ts),
// the race room relays it (`Racer.rider`); a legend's code is its id, your own's is its look code.

import { decodeLook, type LookCode } from './look.ts';

export const RIDER_IDS = ['marlowe', 'kirika', 'okonkwo', 'ines'] as const;
export type Legend = (typeof RIDER_IDS)[number];
/** A legend, or a driver of your own (its look code). */
export type Rider = Legend | LookCode;

export interface RiderInfo {
  id: Rider;
  name: string;
  /** What the passes call them. */
  nick: string;
  tag: string;
  bio: string;
  /** Their glow: goggle lenses, seams, implants. */
  color: number;
}

export const RIDERS: Record<Legend, RiderInfo> = {
  marlowe: {
    id: 'marlowe',
    name: 'Marlowe Vance',
    nick: 'The Governor',
    tag: 'Clockwork gentleman',
    bio: 'Lost his right arm to a gearbox and built himself a better one in brass. Drives a pass the way he winds a watch: precise, patient, never late.',
    color: 0xffae3c,
  },
  kirika: {
    id: 'kirika',
    name: 'Kirika Sato',
    nick: 'Volt',
    tag: 'Neon courier',
    bio: 'Ran contraband batteries over the passes at fourteen. The respirator is for the tunnels, the carbon arm is for the hairpins.',
    color: 0xff2fd2,
  },
  okonkwo: {
    id: 'okonkwo',
    name: 'Okonkwo Adeyemi',
    nick: 'Boiler',
    tag: 'Steam-age mechanic',
    bio: 'Rebuilds engines by ear in a mountain shed full of copper and pressure gauges. If it has pistons, he can make it scream.',
    color: 0x3dff8e,
  },
  ines: {
    id: 'ines',
    name: 'Inès Varga',
    nick: 'Wraith',
    tag: 'Night-run ghost',
    bio: "Nobody's seen her lose, and few have seen her at all. The monocle reads the road a corner before she gets there.",
    color: 0xff3b30,
  },
};

export const isLegend = (x: unknown): x is Legend => typeof x === 'string' && (RIDER_IDS as readonly string[]).includes(x);
/** A legend, or a look that decodes and can be worn. */
export const isRider = (x: unknown): x is Rider => isLegend(x) || decodeLook(x) !== null;

/** The driver every new garage starts with. */
export const defaultRider = (): Legend => RIDER_IDS[0];

/** Who a driver is, for cards and the lobby: a legend's bio, or your own (glowing in their own colour). */
export function riderInfo(r: Rider): RiderInfo {
  if (isLegend(r)) return RIDERS[r];
  const look = decodeLook(r);
  return {
    id: r,
    name: 'Own driver',
    nick: 'One of a kind',
    tag: 'Built in the garage',
    bio: 'Made in the garage from the same brass, leather and neon as the legends. Nobody else looks like this.',
    color: look?.glow ?? 0xffae3c,
  };
}

/** Anything (stored JSON, a request body) to a valid rider. Saves from the old customisable drivers get the default. */
export const cleanRider = (x: unknown): Rider => (isRider(x) ? x : defaultRider());

/** Longest rider code the server reads (a look code is ~70 characters; decodeLook refuses over 200). */
export const RIDER_CODE_MAX = 200;

export const encodeRider = (r: Rider): string => r;
export const decodeRider = (code: string | null | undefined): Rider | null => (isRider(code) ? code : null);

/** A rider code made safe for the wire: valid codes pass, anything else becomes the default rider. */
export const cleanRiderCode = (code: unknown): string => cleanRider(typeof code === 'string' ? code.slice(0, RIDER_CODE_MAX) : null);

/** A solo rival's driver: every legend but yours, in turn (all four when you drive your own). */
export const rivalRider = (mine: Rider, i: number): Legend => {
  const others = RIDER_IDS.filter((d) => d !== mine);
  return others[i % others.length];
};
