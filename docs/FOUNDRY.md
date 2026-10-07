# The Foundry (Survival map)

A walled-in, derelict factory yard at night. The structure is Call of Duty zombies: start in a small room with a pistol, buy doors to open the rest, buy guns off the walls, gamble on a Mystery Box, Pack-a-Punch the gun in your hands, and nail the boards back over the windows the horde breaks in through. Movement is still the Atrous movement (bhop, slide, wallrun, grapple, double jump), so the horde is something to run circles around as much as something to shoot.

Code: `src/shared/foundry.ts` (geometry + layout), `layout.ts` (types), `nav.ts` and `siege.ts` (zombie routing), `colliders.ts`, `interact.ts`, `weapons.ts`; server `src/server/survival.ts`; client `src/client/foundryworld.ts` (+ `foundrytextures.ts`, `foundrybox.ts`).

## Floor plan

Metres; x east, z south, y up. The building is x ±36, z -32..24 inside a compound x ±50, z -46..38 (14 m perimeter wall). Walls are 9 m high under a solid roof, so the grapple can't haul you out.

```
        Locker ─D6─ Furnace (Pack-a-Punch) ─── Dock
          │D4          │D3                        │D5
        Boiler ─D1─── ASSEMBLY HALL ───D2─ Storage (Juggernog)
                       │ stairs up to the mezzanine (z -18..-12, y 4)
                       │D0
                     Office (start)
```

| Door | Price | Joins |
| --- | --- | --- |
| D0 Office door | 750 | Office - Hall |
| D1 Boiler Room | 1000 | Hall - Boiler |
| D2 Storage | 1000 | Hall - Storage |
| D3 Furnace | 1500 | Hall - Furnace |
| D4 Locker Room | 1250 | Boiler - Locker |
| D5 Loading Dock | 1250 | Storage - Dock |
| D6 Locker to Furnace | 1000 | Locker - Furnace (closes the loop Hall - Boiler - Locker - Furnace - Hall) |

Wall guns: Marshal (Office), Rattler (Hall), Warden (Boiler), Bramble (Storage), Kestrel (Mezzanine). Mystery Box spots: Boiler, Dock, Locker, Storage (it moves after the plush). Pack-a-Punch is in the Furnace, Juggernog in Storage, and the other perks each in a room you have to buy: Swift Mend (Boiler Room), Second Wind (Locker Room), Zephyr Fizz (Loading Dock). Every perk machine is a 'machine' cooler against a wall (`lay.perks`: where it stands and its yaw). Fourteen boarded bays (`WINDOWS`) in the outside walls, 2 to 4 per room; each is an opening 3 m wide, floor to 3 m, with five planks.

## Moving parts (all server-authoritative)

- **Doors**: a solid `Door.box` in the wall gap until bought. Open doors are in `world.doors`; both sides rebuild `buildColliders` and `Nav.setDoors`.
- **Windows**: `Barricade.seal` blocks zombies while any plank is up; `Barricade.blocker` blocks *players* always (nobody walks out into the yard). Bullets and the grapple pass through the gap (`Colliders.shot`). A zombie spawns at an unlocked window (in a room joined to the start room by open doors, among the three nearest a player), walks to `outside`, the front one of the queue tears a plank every `SURVIVAL.tearTime`, and once the seal is gone it walks through and joins the chase (`gate = -1`, `siege.ts`). Hold F to nail a plank back (`repairTime` each, +10 points) unless a zombie stands on it.
- **Mystery Box** (`BoxState`): closed -> rolling (spins guns for 3.6 s) -> ready (9 s for the payer to press F) -> closed; after 3 uses 14 % of rolls are the plush: points refunded, the box leaves and reappears at another spot.
- **Max Ammo**: a dead zombie drops one 1 time in 100, the horde at most once every 4 rounds, the boss every time (`Survival.maybeDrop`, tests in `survivalplus.test.ts`). Walk into it and every player's guns are full; it fades after `SURVIVAL.dropLife`.
- **Guns**: two slots per player. Wall buy: new gun into the free slot (or replaces the one in hand); buying one you own refills it for half price (4500 if punched). Pack-a-Punch upgrades the gun in hand for 5000 and refills it.

## Zombie navigation

No navmesh. `Nav` is a graph of rooms (rectangles with a height range; the stairs and mezzanine share the hall's footprint and are listed first) joined by `Link`s (a doorway: centre, axis, half width, door id). A zombie in another room than its target walks to a spot in front of the doorway on the BFS route, then straight through it; inside a room it chases directly and the zombie AI hops anything up to 1.4 m and detours around the rest. Zombies rank targets by `Nav.cost` (distance + 25 m per doorway, +10 km when no open route), so they go for the reachable player. **Authoring rule:** keep furniture hoppable (<= 1.3 m) or compact (a pillar); a tall slab across a lane can trap the AI. `tests/foundry.test.ts` walks a zombie from windows to a 4x4 grid of points in every room and fails if any is unreachable.

## Look and performance

- Every static box is baked (`bake`) into world-space geometry with UVs in metres and floor/ceiling darkening in vertex colours, merged by material: brick, plate, hazard, machine, boiler, crate, conveyor, gravel, plus one concrete floor mesh, lamp shades, panes, props. About 35 draw calls and 6k triangles for the whole map. Boilers are drawn as tanks over their box colliders.
- Light is faked: a moon (the only shadow caster; the shadow map is redrawn every third frame), a hemisphere light, **one** warm point light that follows you, glow sprites on every lamp (one `Points` draw), additive light pools on the floor and moonbeam shafts under the skylights (flickering lamps animate vertex colours, not lights).
- Dynamic bits: doors (7 meshes), planks (one `InstancedMesh` for all 14 windows plus a few flying planks), the Mystery Box and wall-gun displays (small groups reusing the viewmodel gun builders), the two stations.
- Textures are procedural canvases (`foundrytextures.ts`): sooty brick, poured concrete, rusted riveted plate, hazard stripes, painted machinery, boiler plate, crates, gravel, planks, stencilled signs, night windows.

## Checklist when changing the map

1. `npx tsx --test tests/foundry.test.ts`: every station, spawn and window approach is clear, every room is reachable, players can't leave through windows, zombies reach everywhere.
2. `tests/survival.test.ts` for the buying rules; `tests/weapons.test.ts` for prices vs wall guns.
3. Look at it (`window.__game` teleports; see CLAUDE.md "Verifying in the browser").
