// Falling off a sky road (2026-11-12, Michael: "going off the edges launches you in the sky").
//
// vehicle.ts `catchFall` puts a car back once it has dropped SKY.fall m under the road at its `s`. On a sky road whose
// stretches run side by side (Shura's hairpins), a car that flew off one stretch could reach the next one first, a
// few metres *under* it: the ground there is that road's surface, so the suspension pushed the car up through it at
// 200 m/s, into the sky. And far off the road `s` can snap to the other stretch, putting you back a bend ahead.
//
// This catches the fall before any of that: a car under a road, or one going over the edge (wheels off it and sinking),
// goes back where it left the road. Fall handling only: the driving (vehicle.ts) is untouched.

import { SKY, type Track, heightAt, inGap, onFork, pointAt } from './track.ts';
import { type Car, resetCar } from './vehicle.ts';

export const SKYFALL = {
  /**
   * Wheels over the edge and the car this far below where it would ride on the road: it's going over, put back now.
   * Any later and the road's edge, coming back under wheels that had dropped below it, kicked the car into the air.
   */
  drop: 0.2,
  /** The ground at the car is this far above its middle: it has fallen under another stretch of road. */
  under: 0.5,
};

/** Where each car was last on the road (its `s`), to put it back there. */
const lastOn = new WeakMap<Car, number>();

/**
 * A sky road, after each stepCar: puts a car that went off the edge back on the middle of the road where it left it,
 * stopped. True when it did. Does nothing on other roads.
 */
export function skyFall(car: Car, t: Track): boolean {
  if (t.abyss === undefined) return false;
  const edge = t.half + SKY.lip;
  const off = Math.abs(car.d) > edge;
  // (On the road: over it and not under it. Flying over another stretch isn't.)
  if (!off && car.p.y > pointAt(t, car.s, 0).y) lastOn.set(car, car.s);
  const road = lastOn.get(car) ?? car.s;
  // Going over: wheels hanging off the edge and the car sinking under the road (its middle at least past the white
  // line). (Near the road its `s` is right; further out it can snap to another stretch.)
  const near = Math.abs(car.d) < 2 * edge ? car.s : road;
  const ride = pointAt(t, near, Math.sign(car.d) * Math.min(edge, Math.abs(car.d))).y + car.spec.cg;
  const dropped = Math.abs(car.d) > t.half && car.p.y < ride - SKYFALL.drop;
  const under = heightAt(t, car.p.x, car.p.z, undefined, car.hint) > car.p.y + SKYFALL.under;
  // (And vehicle.ts `catchFall`'s rule: SKY.fall m under the road at `s`, wherever `s` has got to.)
  const fell = car.p.y < pointAt(t, car.s, 0).y - SKY.fall;
  if (!dropped && !under && !fell) return false;
  resetCar(car, t, road);
  lastOn.set(car, road);
  return true;
}

/**
 * A gap in the road (track.ts `gap`), after each stepCar: a car that came down short and is dropping into the ravine is
 * put back on the far side, on the middle of the road, stopped. Caught as soon as it sinks under where it would ride,
 * before the far edge (a wall under the road's end) can catch it from below and throw it up: so is a car that came
 * down short on the far edge with its tail still over the hole (the edge caught under its tail threw it 20 m/s up).
 * True when it did.
 */
export const GAPFALL = {
  /** The car's middle this far under where it would ride on the road (were the road there): it's falling in. */
  sink: 0.45,
  /** A car's tail this far over the hole still counts as over it. */
  tail: 1,
  /** ...and then sunk this far under where it would ride: its tail is caught on the edge. */
  tailSink: 0.15,
  /** Put back this far past the hole. */
  after: 14,
};

export function gapFall(car: Car, t: Track): boolean {
  // (A fork's other road has no gaps, whatever the main road has at the same distance.)
  if (!t.gaps.length || onFork(t, car.hint)) return false;
  // Over the hole, or just past it with the tail still hanging over it (a car that came down on the far edge).
  const over = inGap(t, car.s);
  const g = over ?? inGap(t, car.s - car.spec.body.hl - GAPFALL.tail);
  if (!g) return false;
  // (Within the road's width: a car over the barrier line is out over the ravine too.)
  const ride = pointAt(t, car.s, Math.sign(car.d) * Math.min(t.half, Math.abs(car.d))).y + car.spec.cg;
  if (car.p.y > ride - (over ? GAPFALL.sink : GAPFALL.tailSink)) return false;
  resetCar(car, t, g.s1 + GAPFALL.after);
  return true;
}
