// The Survival armoury: nine guns, each with a Pack-a-Punched twin. Pure data and rules shared by server and client.
import { SURVIVAL, WEAPON } from './constants.ts';

export type WeaponId = 'sparrow' | 'marshal' | 'rattler' | 'warden' | 'bramble' | 'kestrel' | 'hammer' | 'awp' | 'sunbeam';

/** Which rig and animation set the viewmodel uses (gambol/client/weapon/guns.ts). */
export type GunStyle = 'pistol' | 'revolver' | 'smg' | 'rifle' | 'pump' | 'lever' | 'lmg' | 'bolt' | 'ray';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** The Pack-a-Punched name. */
  punchedName: string;
  style: GunStyle;
  /** Hold the trigger to keep firing. */
  auto: boolean;
  /** Damage per pellet to the body; the head takes headMult times that. */
  damage: number;
  headMult: number;
  pellets: number;
  /** Hip-fire cone half-angle in radians; aiming down sights (or scoped) uses adsSpread. */
  spread: number;
  adsSpread: number;
  /** Seconds between shots; the server rate-limits with it. */
  fireCooldown: number;
  mag: number;
  /** Rounds carried beyond the mag. */
  reserve: number;
  reloadTime: number;
  /** Vertical FOV when aiming (the AWP's is its scope). */
  zoomFov: number;
  /** Aiming shows the full scope overlay instead of looking down the sights. */
  scoped: boolean;
  /** Blast radius around the impact point (the Sunbeam); 0 = none. */
  splash: number;
  /** Where it hangs on a wall for sale (0 = box only). */
  price: number;
  /** Punched shots also hit zombies lined up behind the first. */
  pierces: boolean;
}

const gun = (d: Omit<WeaponDef, 'adsSpread' | 'zoomFov' | 'scoped' | 'splash' | 'price' | 'pierces'> & Partial<WeaponDef>): WeaponDef => ({
  adsSpread: d.spread * 0.2,
  zoomFov: 62,
  scoped: false,
  splash: 0,
  price: 0,
  pierces: false,
  ...d,
});

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  sparrow: gun({ id: 'sparrow', name: 'Sparrow M1911', punchedName: 'Sparrow Deluxe', style: 'pistol', auto: false, damage: 26, headMult: 2.5, pellets: 1, spread: 0.012, fireCooldown: 0.16, mag: 8, reserve: 64, reloadTime: 1.5 }),
  marshal: gun({ id: 'marshal', name: 'Marshal .44', punchedName: 'Marshal & Sally', style: 'revolver', auto: false, damage: 88, headMult: 2.5, pellets: 1, spread: 0.01, fireCooldown: 0.42, mag: 6, reserve: 42, reloadTime: 2.4, price: 600 }),
  rattler: gun({ id: 'rattler', name: 'Rattler SMG', punchedName: 'Rattlesnake', style: 'smg', auto: true, damage: 19, headMult: 2.2, pellets: 1, spread: 0.028, fireCooldown: 0.075, mag: 32, reserve: 192, reloadTime: 1.9, price: 1000, zoomFov: 66 }),
  warden: gun({ id: 'warden', name: 'Warden AR', punchedName: 'Warden Nightfall', style: 'rifle', auto: true, damage: 32, headMult: 2.5, pellets: 1, spread: 0.02, fireCooldown: 0.095, mag: 30, reserve: 150, reloadTime: 2.2, price: 1200, zoomFov: 58 }),
  bramble: gun({ id: 'bramble', name: 'Bramble 12g', punchedName: 'Bramble Thornpatch', style: 'pump', auto: false, damage: 15, headMult: 1.8, pellets: 8, spread: 0.07, adsSpread: 0.045, fireCooldown: 0.78, mag: 6, reserve: 54, reloadTime: 2.8, price: 1500 }),
  kestrel: gun({ id: 'kestrel', name: 'Kestrel Lever', punchedName: 'Kestrel Stormcaller', style: 'lever', auto: false, damage: 72, headMult: 3, pellets: 1, spread: 0.014, fireCooldown: 0.4, mag: 8, reserve: 56, reloadTime: 2.6, price: 1500, zoomFov: 50 }),
  hammer: gun({ id: 'hammer', name: 'Hammer LMG', punchedName: 'Hammer of Dawn', style: 'lmg', auto: true, damage: 27, headMult: 2.2, pellets: 1, spread: 0.032, fireCooldown: 0.082, mag: 100, reserve: 300, reloadTime: 5, zoomFov: 62, price: 3000 }), // on the wall in the Foundry's hidden Duck Shrine
  awp: gun({
    id: 'awp',
    name: 'AWP',
    punchedName: 'AWP Moonpiercer',
    style: 'bolt',
    auto: false,
    damage: 115,
    headMult: 3.9,
    pellets: 1,
    spread: WEAPON.hipSpread,
    adsSpread: 0,
    fireCooldown: WEAPON.fireCooldown,
    mag: WEAPON.magSize,
    reserve: 50,
    reloadTime: WEAPON.reloadTime,
    zoomFov: WEAPON.scopedFov,
    scoped: true,
    pierces: true,
  }),
  sunbeam: gun({ id: 'sunbeam', name: 'Sunbeam', punchedName: 'Sunbeam Supernova', style: 'ray', auto: false, damage: 150, headMult: 1.5, pellets: 1, spread: 0.008, fireCooldown: 0.4, mag: 20, reserve: 100, reloadTime: 3, splash: 2.6 }),
};

/** A gun in a player's hands: which, and whether it is Pack-a-Punched. */
export interface Slot {
  w: WeaponId;
  up: boolean;
}

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** Everyone starts with this. */
export const STARTER: WeaponId = 'sparrow';

/** What the Pack-a-Punch does to a gun. Faster, bigger and much stronger; every gun, the same way. */
export const PUNCH = { damage: 2.5, mag: 1.5, reserve: 1.5, fireCooldown: 0.85, reloadTime: 0.7, splash: 1.4 };

/** A gun's numbers, stock or punched. */
export interface GunStats extends WeaponDef {
  punched: boolean;
  label: string;
}

const cache = new Map<string, GunStats>();
export function gunStats(id: WeaponId, punched: boolean): GunStats {
  const key = `${id}${punched ? '+' : ''}`;
  let s = cache.get(key);
  if (!s) {
    const d = WEAPONS[id];
    s = punched
      ? {
          ...d,
          punched,
          label: d.punchedName,
          damage: d.damage * PUNCH.damage,
          mag: Math.round(d.mag * PUNCH.mag),
          reserve: Math.round(d.reserve * PUNCH.reserve),
          fireCooldown: d.fireCooldown * PUNCH.fireCooldown,
          reloadTime: d.reloadTime * PUNCH.reloadTime,
          splash: d.splash * PUNCH.splash,
        }
      : { ...d, punched, label: d.name };
    cache.set(key, s);
  }
  return s;
}

/** Wall-buy ammo is half the gun's price; refilling a punched gun costs this (the Pack-a-Punch's own ammo price). */
export const ammoPrice = (id: WeaponId, punched: boolean) => (punched ? SURVIVAL.punchAmmoPrice : Math.round(WEAPONS[id].price / 2 / 10) * 10);

/** The guns the Mystery Box can hand out: everything but the starter pistol, minus what you already carry. */
export function boxPool(owned: readonly WeaponId[]): WeaponId[] {
  return WEAPON_IDS.filter((id) => id !== STARTER && !owned.includes(id));
}

export const bodyDamage = (s: GunStats) => s.damage;
export const headDamage = (s: GunStats) => s.damage * s.headMult;
