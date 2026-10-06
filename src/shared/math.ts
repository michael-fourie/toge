// Tiny allocation-light vector helpers. Shared by client and server, so no three.js here.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (o: Vec3, a: Vec3): Vec3 => ((o.x = a.x), (o.y = a.y), (o.z = a.z), o);
export const set = (o: Vec3, x: number, y: number, z: number): Vec3 => ((o.x = x), (o.y = y), (o.z = z), o);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const hlen = (a: Vec3): number => Math.hypot(a.x, a.z);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function addScaled(o: Vec3, a: Vec3, s: number): Vec3 {
  o.x += a.x * s;
  o.y += a.y * s;
  o.z += a.z * s;
  return o;
}

/** Forward (look) direction on the horizontal plane for a yaw. Yaw 0 looks down -Z (three.js convention). */
export function yawForward(yaw: number, o: Vec3 = v3()): Vec3 {
  return set(o, -Math.sin(yaw), 0, -Math.cos(yaw));
}

export function yawRight(yaw: number, o: Vec3 = v3()): Vec3 {
  return set(o, Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Full 3D look direction from yaw/pitch (pitch > 0 looks up). */
export function lookDir(yaw: number, pitch: number, o: Vec3 = v3()): Vec3 {
  const cp = Math.cos(pitch);
  return set(o, -Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
