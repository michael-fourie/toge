# Map plan: "Windward"

The goal is a map that *flows*: every route rewards momentum, and every lane teaches a different mechanic. All lanes converge on one memorable centrepiece, with height used for both sniping and escape.

## Feel

- **Fast in, slow middle.** You leave spawn at speed: a slide ramp, then wind gates, then bhop stones or a surf run. The middle is a vertical playground to fight in.
- **Three lanes, three skills.** Speed (slide + bhop), surf (A-frames), and ruins (wallrun + cover). You pick a style and still arrive in the middle at roughly the same time.
- **Height is a choice.** Low ground has cover, roots and ruins. Mid ground is the open island. The high ground is the tree's branches and crown: great sightlines, but exposed, and you get there by bouncing.
- **Never stranded.** Every drop-off over the void either has a surf face or catch island beneath it, or is clearly a deliberate risk.

## New mechanics (shared physics)

| Thing | Look | Behaviour |
| --- | --- | --- |
| **Wind gate** (speed booster) | Plain glowing mint ring | Non-solid trigger. Raises your speed up to `speed` in whichever direction you cross it. It never slows you and never removes sideways speed, so it's safe for momentum. |
| **Puffball** (jump booster) | Giant springy mushroom cap | Non-solid trigger on a floor. Raises upward speed to `up` and horizontal speed *along the way you're already moving* to `push` (straight up if you're standing still). Never slows you. Ends any slide or wallrun. |
| Launch pad (existing) | Mint swirl pad | Aimed throw to a target (`padTo`). Used for the few precise routes, like the canopy crown. |
| Tree trunk | Bark | Solid like a wall, and you can wallrun around it. |
| Canopy (decor) | Leafy toon blobs | Visual only. Players inside it are hidden from view but can still be shot through it. |

Both triggers are idempotent while you're inside them (a "set at least" rule), so they don't need cooldowns. A sound plays when you enter one.

## Layout (one half; the other is rotated 180°)

```
 z +106  ┌──────── Sky Harbor (spawn, y 12) ─────────┐   6 spawns behind the harbor wall
         │  gate      gate (slide ramp)      gate    │   three doorways, each with a wind gate
 z  86   └──┬───────────────┬───────────────────┬────┘
   Surf     │  Windway      │                   │  Old Ruins
   Gorge    │  slide ramp → │ wind gate → bhop  │  ramp down → roofed tunnel,
   2 A-frames  stones → gate over gap          │  wallrun corridor, pillars
   + gate   │               │                   │  → puffball up to a branch
 z  26  exit terrace ─ramp─┐│┌──────────────────┘
         ┌─────────── The Great Tree (centre, y 0) ───────────┐
         │ trunk (wallrun), roots (cover), 2 shrines           │
         │ branches y 8 (E/W) and y 14 (N/S), crown y 22       │
         │ launch pads to branches + crown, puffball by trunk  │
         │ side surf A-frames with catch islands + pads back   │
         └─────────────────────────────────────────────────────┘
```

| Area | Height | Purpose |
| --- | --- | --- |
| Sky Harbor | 12 | Safe spawns behind a 2.2 m harbour wall. Doorways line up with the three lanes, and a wind gate in each doorway launches you out. |
| Windway (centre lane) | 12 → 4 → 1 | Slide ramp (~22°), then a speed gate, then three bhop stones with a mid-air gate. This is the fastest route. |
| Surf Gorge (left) | 8 → 4 → −2 | Two descending surf A-frames with a gate between them. They exit onto a terrace, and a ramp leads up into the middle. |
| Old Ruins (right) | 9 → 0 | Ramp down into a corridor between tall walls (wallrun or walk). It has a roofed tunnel you can hide in and also run on top of, plus pillars and arches. It opens onto a terrace beside the island, with a watchtower perch reached by pad. |
| Great Tree (centre) | 0 / 8 / 14 / 23 | The trunk can be wallrun all the way round, and a puffball beside it helps you catch the bark. Roots give low cover, and two shrines give rooms to hide in. Launch pads reach the branches and the crown, a sniper nest hidden in the canopy. |
| Side surf | −5 → 2 | A combat-surf A-frame on each flank of the centre, a short hop off the island's edge, with a wind gate to fling you onto it. |

Kill floor: y −40 (the cloud sea).

## Round 2 additions

| Addition | Where (side A; mirrored on side B) | Purpose |
| --- | --- | --- |
| **Mill House** | Island x 8..20, z 46..70 (top 3), bridged down from the Windway runway | 3 storeys + grassy roof. Windows on every floor overlook the Windway, the Ruins and the tree; balcony faces the centre. Stair ramps alternate walls through floor holes; the last comes up through a roof hatch behind a parapet. |
| **Cliff House** | Island x −26..−12, z 44..62 (top 2), walkway from the runway | 2 storeys + roof. Balcony hangs over the Surf Gorge for picking off surfers. Crates outside for cover. |
| **Mill Chute** (surf) | A-frame x 9..17, z 28..45 | Gate off the Mill island's south edge, surf down to the centre island. |
| **Gorge Rail** (surf) | A-frame along X at z 33, x −22..−8 | Combat surf just off the centre's north edge; a wind gate on the edge flings you onto it. |
| **Ruined walls** | Centre island: an L-corner at (8..14, 14..19) and a lone wall at x −17 | Break up the island's long sightlines. |
| **More wind gates** | Gorge ledge (launch onto the surf), Ruins corridor, Ruins terrace, Mill Chute entry, centre north edge | Keep speed flowing between the lanes and onto the new surfs. |
| **Mill puffball** | Undercliff (5.5, 49.5) | Run +X across it to hop up onto the Mill House island. |

Fix: surf (and slide) ramps sometimes rendered inside-out. The ramp mesh wound each triangle "away from the centre" of its bounding box, but for a wedge that point lies exactly on the slope, so the slope's winding was a coin toss and its faces got culled (you saw the brown inner faces). It now uses the wedge's centroid.

## Survival spawns

Survival reuses Windward. Players start (and are revived) back to back around the Great Tree at (±9, ±9), facing out. Zombies climb up at ground level on the island's rim and on the ruins terraces (`zombieSpawns`, mirrored), preferring spots at least 12 m from every player. Zombies chase in a straight line: they hop roots and crates, detour sideways along walls, feel along edges, and pounce (a `launchTo` arc) onto ledges, branches and across gaps within 15 m. They ride launch pads but ignore wind gates and puffballs. `zombie.test.ts` checks that a zombie from every spawn reaches both player spawns.

## Lessons from building it

- **Straight-up puffballs next to an overhang don't work** (round 1; puffballs now also push you forward, which helps, but overhangs still need launch pads). Fast runners reach the edge while still rising and bonk the underside. Source air control adds at most 0.76 m/s from standstill, so you can't steer onto the ledge either. Use aimed launch pads (`padTo`) for ledges and branches, and keep puffballs in open air.
- **Every lane must physically connect to the island.** The ruins approach needed a terrace to join the island, which a scripted walk test caught.

## Verification

- **Tests:** every spawn is valid, every pad lands on solid ground, and the trigger physics work (gates never slow you, puffballs keep horizontal speed). Scripted traversals check each lane: the Windway slide-then-bhop reaches the centre, the gorge surf reaches the exit terrace, the ruins walk reaches the centre, and each puffball lands on its branch.
- **In the browser:** spawn view (can you see the lanes?), each lane, the view from the crown, and frame rate.
