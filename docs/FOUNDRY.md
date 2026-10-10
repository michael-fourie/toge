# The Foundry (Survival map)

A walled-in, derelict factory yard at night. The structure is Call of Duty zombies: start in a small room with a pistol, buy doors to open the rest, buy guns off the walls, gamble on a Mystery Box, Pack-a-Punch the gun in your hands, and nail the boards back over the windows the horde breaks in through. Movement is still the Atrous movement (bhop, slide, wallrun, grapple, double jump), so the horde is something to run circles around as much as something to shoot.

Code: `src/shared/foundry.ts` (geometry + layout), `layout.ts` (types), `nav.ts` and `siege.ts` (zombie routing), `colliders.ts`, `interact.ts`, `weapons.ts`; server `src/server/survival.ts`; client `src/client/foundryworld.ts` (+ `foundrytextures.ts`, `foundrybox.ts`, `foundrydecor.ts` for the props and oddities).

## Floor plan

Metres; x east, z south, y up. The main building is x ±36, z -32..24 (walls 9 m high under a solid roof, so the grapple can't haul you out). Across a 12 m strip of yard to the north stands the two-storey **North Wing** (x ±30, z -70..-44; ground floor y 0 under a 4.5 m ceiling, upper floor y 5, roof at 10). Under the north half of everything lies the **Undercroft** (cellars: floor y -6, ceiling y -1, the underside of the yard slab). The compound wall is x ±50, z -88..38 (14 m high).

```
 UPPER (y 5)        Drafting Loft ──D13── Clock Room
                      │D12 (top of the Wing Stairs)   ║ Skybridge (D14; y 4 to 5, covered, over the yard)
 NORTH WING (y 0)   Fitting Rooms ─ Showroom ─ Front of Shop ─D10─ Sorting Floor ─ Dispatch ─D11─ Break Room
                    (Drain Ramp up)                   Parcel Bay (Tunnel Ramp up; Wing Stairs up)
 MAIN (y 0)         Locker ─D6─ Furnace (Pack-a-Punch; the Gantry at y 4 runs over it) ─── Dock
                      │D4          │D3     Gantry ═ Mezzanine (y 4, stairs from the Hall)       │D5
                    Boiler ─D1─── ASSEMBLY HALL ───D2─ Storage (Juggernog)
                                   │D0    └D7 the Undercroft stairs, under the mezzanine's east end
                                 Office (start)
 UNDERCROFT (y -6)  Undercroft Stairs ─ Stair Foot ─ Pump Room ─D8─ Cold Storage ═(collapsed wall)═ Old Drain ─ Drain Ramp
                                                     ├(squeeze by the flooded corner)─ Duck Shrine
                                                     └D9─ Rail Tunnel ─ Tunnel Ramp
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
| D7 Undercroft | 1500 | Hall - Undercroft Stairs (walled in under the mezzanine's east end; the door is at the west end of their south side) |
| D8 Cold Storage | 1750 | Pump Room - Cold Storage |
| D9 Rail Tunnel | 2000 | Pump Room - Rail Tunnel (its ramp comes up into the North Wing's Parcel Bay) |
| D10 Showroom | 2250 | Sorting Floor - Front of Shop (and the Showroom) |
| D11 Break Room | 2250 | Dispatch - Break Room |
| D12 Drafting Loft | 2500 | Stair Landing (top of the Wing Stairs) - Drafting Loft |
| D13 Clock Room | 2750 | Drafting Loft - Clock Room |
| D14 Skybridge | 3000 | Gantry (open from the mezzanine) - Skybridge: the dear shortcut straight into the Drafting Loft |
| D15 Skyline | 2000 | the hatch in the Hall roof (no rooms: it opens the roof surf) |

Ways between levels: the old stairs (Hall to mezzanine); the Undercroft stairs (Hall down to the cellar, a walled corridor along the Pump Room's south side); two ramps up out of the cellar tunnels into the North Wing (each in a pit against the wing's partition wall, fenced round its deep end); the Wing Stairs (Parcel Bay up to a landing in an enclosure on the upper floor); the gantry through the Furnace at mezzanine height, and the Skybridge rising from it (y 4) to the Drafting Loft (y 5). A loop: Hall, Undercroft, Rail Tunnel, North Wing, upstairs, Skybridge, gantry, mezzanine, Hall.

Secrets:
- **The Duck Shrine**: a squeeze through the Pump Room's east wall in the flooded corner, behind two crate stacks (a "← DUCKS" scrawl points the way). An altar with a giant rubber duck, rows of ducks, candles, a hand-painted "THE DUCK PROVIDES"; the **Hammer LMG** on its wall (3000, the only wall that sells it) and a Mystery Box spot.
- **The collapsed wall** in Cold Storage: an open way through the Old Drain and up into the Fitting Rooms and the Showroom, so buying Cold Storage (1750) opens them too; the Showroom door is only needed from the Sorting Floor side.

Odd corners (looks only, `client/foundrydecor.ts`): chibi mannequins in party hats, scarves and skirts (the one by the shop door turns its head to watch you); a haunted vending machine with a ghost bobbing beside it, and Barry's lunch in the fridge; desks with blueprints and a giant paper plane in the Drafting Loft; a broken brass gear you walk through, a clock that runs backwards, a pendulum; frozen fish and daikon hanging in Cold Storage; rubber ducks bobbing in the flooded corner; glowing mushrooms along the Old Drain's stream; rails, sleepers and a coal cart in the Rail Tunnel; soot sprites hopping about the dark corners; graffiti ("THEY CAN'T CLIMB (they can)").

The Skyline hatch (2000) is in the Hall's roof over a launch pad; the power switch is on a generator against the Boiler Room's south wall; the Gale Scythe's workbench is on the mezzanine and its parts lie at the far ends: frozen in Cold Storage, among the mannequins in the Showroom, and in the Clock Room. The Tinker's Workbench (contraptions, for coins) stands against the Office's east wall, south of the window (`lay.tinker`).

Wall guns: Marshal (Office), Rattler (Hall), Warden (Boiler), Bramble (Storage), Kestrel (Mezzanine), Hammer (Duck Shrine). Mystery Box spots: Boiler, Dock, Locker, Storage, Pump Room, Duck Shrine, Break Room, Clock Room (it moves after the plush). Pack-a-Punch is in the Furnace, Juggernog in Storage, and the other perks each in a room you have to buy: Swift Mend (Boiler Room), Second Wind (Locker Room), Zephyr Fizz (Loading Dock). Every perk machine is a 'machine' cooler against a wall (`lay.perks`: where it stands and its yaw). 23 boarded bays (`WINDOWS`): 14 in the main building, 7 on the North Wing's ground floor, and two storm grates in the cellar tunnels that open onto sunken drainage cuts in the yard (their zombies spawn down in the cut). Each is an opening 3 m wide, floor to 3 m, with five planks. The upper floor has no bays: its zombies come up the stairs or over the bridge.

## Moving parts (all server-authoritative)

- **Doors**: a solid `Door.box` in the wall gap until bought. Open doors are in `world.doors`; both sides rebuild `buildColliders` and `Nav.setDoors`.
- **Windows**: `Barricade.seal` blocks zombies while any plank is up; `Barricade.blocker` blocks *players* always (nobody walks out into the yard). Bullets and the grapple pass through the gap (`Colliders.shot`). A zombie spawns at an unlocked window (in a room joined to the start room by open doors, among the three nearest a player), walks to `outside`, the front one of the queue tears a plank every `SURVIVAL.tearTime`, and once the seal is gone it walks through and joins the chase (`gate = -1`, `siege.ts`). Hold F to nail a plank back (`repairTime` each, +10 points) unless a zombie stands on it.
- **Mystery Box** (`BoxState`): closed -> rolling (spins guns for 3.6 s) -> ready (9 s for the payer to press F) -> closed; after 3 uses 14 % of rolls are the plush: points refunded, the box leaves and reappears at another spot.
- **Max Ammo**: a dead zombie drops one 1 time in 100, the horde at most once every 4 rounds, the boss every time (`Survival.maybeDrop`, tests in `survivalplus.test.ts`). It lands on the floor of the room the zombie died in (cellar, ground or upstairs). Walk into it and every player's guns are full; it fades after `SURVIVAL.dropLife`.
- **Power** (`world.power`): off at the start of a run. Perk machines, Juggernog and the Pack-a-Punch answer `status: 'off'` until someone uses the switch on the Boiler Room generator (`lay.power`). Off, the lamps run at 8 % (the follow light and moon stay); on, they stutter up.
- **Gale Scythe** (`world.parts`, `world.scythe`): parts at `lay.parts` (Cold Storage, Showroom, Clock Room; F picks one up for the team), built and taken at `lay.bench` (mezzanine). The carrier's knife key brings it out; a swing (`shoot` with `knife`) makes the server cut every zombie within `SCYTHE.range` all the way round (the client names no one). It goes back on the bench when the carrier leaves or bleeds out.
- **Skyline** (roof surf): the hatch is door `lay.hatch` (no link: zombies never route through it). Open, `lay.hatchPad` joins the move colliders and throws you through the hatch onto the tower (y 16). Three surf A-frames (ridge y 14.2) run west, east and north over the roof, each followed by a lower one (ridge 6.5) inside the Boiler Room, Storage and the Furnace, through a hole in the roof. Each hole has a lid (`lay.chutes`) in the colliders until `openRooms` says its room is open. The roof is never lethal. Zombies can't get up there: the hatch and every chute lid are always in `Colliders.zombie` (they used to pounce up through the open hatch, `leapMaxUp` being 16 m), and the horde ignores anyone above `SKYLINE.roofY`. Standing about on the roof (or stranded in the yard after a fast surf off the building) runs a clock (`shared/skyline.ts` `roofClock`: only time on your feet counts, never surfing or flying); at `SKYLINE.grace` the client's steam vents drop you at `lay.vent`, high in the Hall and clear of the pad (`Game.roofTick`, a warning 2 s before). Tests: `tests/skyline.test.ts` rides every line (with a pause on the tower, and onto shut lids), `survivalfun.test.ts` checks the roof never hurts and zombies never get up there.
- **Contraptions** (`shared/contraptions.ts`, server `workshop.ts`, client `contraptions.ts` + `workshop.ts`): F at the Tinker's Workbench (`findUse` kind `tinker`) opens the client's menu. Picking one enters placement: a ghost on the flat top under the crosshair (`floorUnder`), checked by `placeProblem` (inside a room that's open, below the roof, flat floor under the whole footprint and not a pad or bench, nothing solid in the way, `WORKSHOP.spacing` from the others). A click spends the **coins** (client-side stash) and sends `build`; the server re-checks the spot, the reach, `perPlayer` / `perLobby` and the cooldown, and either broadcasts `contraptions` or sends `refund` (share 1). F on your own one (`scrap`) refunds half. They are non-solid for everyone. Every tick (20 Hz) each one with nothing on cooldown looks for zombies in range and in sight (`Colliders.shot`): spikes drop piles (`spikePiles`, `spikeCharges` pokes each), tacks hit everything within range, goo sets `Zombie.goo` (zombie.ts walks at `gooSlow` while it lasts; players are never touched), the lobber's bomb lands after `bombFlight` and splashes `bombRadius`, the zapper chains `zapChain` jumps, the owl shoots the toughest zombie in sight. Damage goes through `Survival.hurt` with `by` (no hit points; kills pay the owner kill points, count as theirs, roll Max Ammo, and `zombieDied.by` keeps the client from popping feats). Damage grows `WORKSHOP.perRound` a round. Effects travel as `cfx`. Cleared with the run, and with their owner when they leave. Tests: `tests/contraptions.test.ts`.
- **Jobs and modifiers**: see `JOBS` (constants.ts, `pickJob` in zombie.ts) and `modifiers.ts`; both are rolled with `Survival.rand` so tests can fix the dice. Tests: `tests/survivalfun.test.ts`.
- **Guns**: two slots per player. Wall buy: new gun into the free slot (or replaces the one in hand); buying one you own refills it for half price (4500 if punched). Pack-a-Punch upgrades the gun in hand for 5000 and refills it.

## Zombie navigation

No navmesh. `Nav` is a graph of rooms (rectangles with a height range, plus their `floor` and `ceil`) joined by `Link`s (a doorway or open floor: centre, axis, half width, door id; open ones are `ARCHES` in foundry.ts). Rooms stack: `roomAt` picks a ramp where one runs, else the room with the highest `y0`, else the smaller (the gantry over the Furnace floor; the Dock over the cellar stairs' foot). A zombie in another room than its target walks to a spot in front of the doorway on the BFS route, then straight through it, and keeps on to the far side before thinking again (`Zombie.exit`, siege.ts: where a room wraps round another's door, the next straight line could lead right back in). Low on a staircase that stands in a room (`base`), heading anywhere but up it, a zombie counts as in that room and steps off the side. Inside a room it chases directly and the zombie AI hops anything up to 1.4 m and detours around the rest. Zombies rank targets by `Nav.cost` (distance + 1.5 x height + 25 m per doorway, +10 km when no open route), so they go for the reachable player.

**Authoring rules:**
- Keep furniture hoppable (<= 1.3 m) or compact (a pillar); a tall slab across a lane can trap the AI.
- A room is a rectangle a zombie can cross in a straight line. Where something stands in the middle (a ramp pit, a stair enclosure), split the floor into rectangles round it and join them with open arches (the North Wing's Fitting Rooms, Front of Shop, Parcel Bay and Dispatch exist for this).
- Room footprints meet at wall planes (a gap between rooms is "outside", where a zombie just walks straight at you).
- A ramp room covers only the ramp (up to just over its top step), never a floor above or below it.
- Put doors on a stair shaft where nobody walks past.

`tests/foundry.test.ts` walks a zombie from every window to the middle of every room, and from three windows to a 4x4 grid of points in every room, and fails if any is unreachable (150 s at round-1 speed: the far end of the North Wing is ~200 m from the Office). `tests/foundrylevels.test.ts` walks players through every way between levels and both secrets, and checks stacked rooms, raised doors and door gating.

## Look and performance

- Every static box is baked (`bake`) into world-space geometry with UVs in metres and darkening near its storey's floor and ceiling in vertex colours, merged by material: brick, plate, hazard, machine, boiler, crate, conveyor, gravel, plus three floor meshes (concrete, floorboards, tiles: a plane per room clipped to the slab under it, so stair holes and pits stay open), lamp shades, panes, props. The decor (`foundrydecor.ts`) is one vertex-coloured toon mesh and one glow mesh, plus a handful of small moving pieces (the watcher's head, the clock hands, the pendulum, the ghost, the soot sprites, the vending machine's flickering panel). Boilers are drawn as tanks over their box colliders.
- Light is faked: a moon (the only shadow caster; the shadow map is redrawn every third frame), a hemisphere light, **one** warm point light that follows you, glow sprites on every lamp (one `Points` draw), additive light pools on the floor and moonbeam shafts under the skylights (flickering lamps animate vertex colours, not lights).
- Dynamic bits: doors (7 meshes), planks (one `InstancedMesh` for all 14 windows plus a few flying planks), the Mystery Box and wall-gun displays (small groups reusing the viewmodel gun builders), the two stations.
- Textures are procedural canvases (`foundrytextures.ts`): sooty brick, poured concrete, rusted riveted plate, hazard stripes, painted machinery, boiler plate, crates, gravel, planks, stencilled signs, night windows.

## Checklist when changing the map

1. `npx tsx --test tests/foundry.test.ts tests/foundrylevels.test.ts`: every station, spawn and window approach is clear, every room is reachable, players can't leave through windows, zombies reach everywhere; players walk every way between levels, the secrets work, stacked rooms are told apart, doors gate what they should.
2. `tests/survival.test.ts` for the buying rules; `tests/weapons.test.ts` for prices vs wall guns.
3. Look at it (`window.__game` teleports; see CLAUDE.md "Verifying in the browser").
