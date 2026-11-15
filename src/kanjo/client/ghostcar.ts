// The track record's ghost in an online race (the host's Record ghost toggle): the record run (shared/ghost.ts)
// played back as a see-through car you drive straight through. It isn't a racer: no place, no collisions, no prize.
// racegame.ts owns it, steps its clock from GO and gives it a name tag.

import * as THREE from 'three';
import { CARS, type CarSpec, carSpec, decodeCar, newOwnedCar } from '../shared/cars.ts';
import { type GhostRun, type Track3, poseAt, unpack } from '../shared/ghost.ts';
import { decodeRider, defaultRider } from '../shared/rider.ts';
import { type CarModel, buildCar, ghostly } from './carmodel.ts';

export class GhostCar {
  readonly model: CarModel;
  readonly spec: CarSpec;
  readonly run: GhostRun;
  /** Its paint, for the map dot and tag. */
  readonly color = '#8fe3ff';
  private tape: Track3;
  private hint = 0;
  private spin = 0;
  private pose = { p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0] };
  /** How far along the road it is (for the map), set by the race. */
  s = 0;

  constructor(run: GhostRun, scene: THREE.Scene) {
    this.run = run;
    const owned = decodeCar(run.car) ?? newOwnedCar('pebble');
    this.model = buildCar(owned, decodeRider(run.rider) ?? defaultRider());
    ghostly(this.model, 0.3);
    this.spec = carSpec(owned);
    this.tape = unpack(run.d);
    scene.add(this.model.root);
    this.update(0, 0);
  }

  get height() {
    return CARS[this.spec.id].height - this.spec.cg;
  }

  /** Where the run was `t` seconds after GO. */
  update(t: number, dt: number) {
    const o = this.pose;
    this.hint = poseAt(this.tape, t, o, this.hint);
    const root = this.model.root;
    root.position.set(o.p[0], o.p[1], o.p[2]);
    root.quaternion.set(o.q[0], o.q[1], o.q[2], o.q[3]);
    // Wheels roll with its speed (its own forward direction says which way).
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion);
    const speed = fwd.x * o.v[0] + fwd.y * o.v[1] + fwd.z * o.v[2];
    this.spin += (speed / this.spec.radius) * dt;
    const sp = this.spec;
    const restY = (a: number) => sp.mountY[a] - (sp.rest - (sp.rest + sp.radius - sp.cg - sp.mountY[a]));
    this.model.pose(
      [0, 1, 2, 3].map((i) => ({ y: restY(i < 2 ? 0 : 1), angle: this.spin })),
      0,
      false,
    );
  }

  get position() {
    return this.model.root.position;
  }

  dispose() {
    this.model.root.removeFromParent();
    this.model.dispose();
  }
}
