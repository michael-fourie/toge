# Map plan: "Windward"

A replacement for Skyhop. The goal is a map that *flows*: every route rewards momentum, and every lane teaches a different mechanic. All lanes converge on one memorable centrepiece, with height used for both sniping and escape.

## Feel

- **Fast in, slow middle.** You leave spawn at speed: a slide ramp, then wind gates, then bhop stones or a surf run. The middle is a vertical playground to fight in.
- **Three lanes, three skills.** Speed (slide + bhop), surf (A-frames), and ruins (wallrun + cover). You pick a style and still arrive in the middle at roughly the same time.
- **Height is a choice.** Low ground has cover, roots and ruins. Mid ground is the open island. The high ground is the tree's branches and crown: great sightlines, but exposed, and you get there by bouncing.
- **Never stranded.** Every drop-off over the void either has a surf face or catch island beneath it, or is clearly a deliberate risk.

## New mechanics (shared physics)

| Thing | Look | Behaviour |
| --- | --- | --- |
| **Wind gate** (speed booster) | Mint wind ring with chevrons streaming through it | Non-solid trigger. Raises your speed *along its direction* up to `speed`. It never slows you and never removes sideways speed, so it's safe for momentum. |
| **Puffball** (jump booster) | Giant springy mushroom cap | Non-solid trigger on a floor. Sets upward speed to `up`, keeps all horizontal speed, and ends any slide or wallrun. |
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

## Lessons from building it

- **Straight-up puffballs next to an overhang don't work.** Fast runners reach the edge while still rising and bonk the underside. Source air control adds at most 0.76 m/s from standstill, so you can't steer onto the ledge either. Use aimed launch pads (`padTo`) for ledges and branches, and keep puffballs in open air.
- **Every lane must physically connect to the island.** The ruins approach needed a terrace to join the island, which a scripted walk test caught.

## Verification

- **Tests:** every spawn is valid, every pad lands on solid ground, and the trigger physics work (gates never slow you, puffballs keep horizontal speed). Scripted traversals check each lane: the Windway slide-then-bhop reaches the centre, the gorge surf reaches the exit terrace, the ruins walk reaches the centre, and each puffball lands on its branch.
- **In the browser:** spawn view (can you see the lanes?), each lane, the view from the crown, and frame rate.
