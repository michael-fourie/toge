// Dev-only lab for KANJO cosmetics: the garage showroom with any kit on any car, and every item card.
// window.cz: show(carId, kit, plate?), angle(rad) (holds the turntable still), cam(x, y, z, tx?, ty?, tz?),
// cards() (every item card, by slot).

import { CAR_IDS, type CarId, newOwnedCar } from '../src/kanjo/shared/cars.ts';
import { COS_SLOTS, CATALOG, type CosKit } from '../src/kanjo/shared/cosmetics.ts';
import { Showroom } from '../src/kanjo/client/showroom.ts';
import { itemCard } from '../src/kanjo/client/cosmeticsui.ts';
import '../src/kanjo/client/hub.css';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const room = new Showroom(canvas);
type Inner = { spin: number; dragging: boolean; turntable: { rotation: { y: number } }; camera: import('three').PerspectiveCamera; aim(): void };
const inner = room as unknown as Inner;

(window as unknown as { cz: unknown }).cz = {
  cars: CAR_IDS,
  show(id: CarId, kit: CosKit = {}, plate = '', paint = 0) {
    const owned = newOwnedCar(id, paint);
    owned.cos = kit;
    owned.plate = plate;
    room.show(owned);
    inner.aim(); // undo any cam()
  },
  angle(rad: number) {
    inner.dragging = true;
    inner.spin = rad;
    inner.turntable.rotation.y = rad;
  },
  /** Moves the camera (until the canvas resizes): from (x, y, z) at (tx, ty, tz). */
  cam(x: number, y: number, z: number, tx = 0, ty = 0.5, tz = 0) {
    inner.camera.position.set(x, y, z);
    inner.camera.lookAt(tx, ty, tz);
  },
  cards() {
    document.body.classList.add('cards');
    document.getElementById('cards')!.innerHTML = COS_SLOTS.map(
      (s) => `<h3>${s}</h3><div class="cz-grid">${CATALOG[s].map((it) => itemCard(it)).join('')}</div>`,
    ).join('');
  },
};
