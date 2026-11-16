# KANJO

Mountain-pass and circuit racing in the browser, against AI or friends, with a garage economy. Free, no download,
works with a controller (the D-pad or left stick moves, Ⓐ selects, Ⓑ goes back, LB/RB switch tabs) and on phones.


## The game

Race your lobby down the mountain. Two passes: **Kōri Pass** (alpine, 5.3 km, six stacked hairpins, forest esses, a run into the village) and **Saltwind Cliffs** (coastal, 3.6 km, clifftops, a zigzag down the cliff face, the harbour wall).

- **Physics**: a rigid body on four raycast wheels at 480 Hz. Springs, dampers and anti-roll bars, so the car squats, dives and rolls. Pacejka-style tyres with combined slip and relaxation, a torque curve, clutch, gearbox, limited-slip diffs, AWD split, aero drag and downforce. Assists (ABS, traction control, steering assist, automatic gears) can each be turned off in the pause menu.
- **Garage**: five cars from a 100 hp hatch to a 600 hp mid-engined V10, each with a class and PI. Paint (gloss, metallic, matte, pearl), rims, spoiler, stripes, front lip, carbon or black hood and roof, window tint, chrome or black trim and mirror caps; tune ride height, brake bias, diff lock and final drive.
- **Drivers**: four realistic, steampunk-meets-cyberpunk drivers (a clockwork gentleman with a brass arm, a neon courier in a respirator, a steam-age mechanic, a monocled night-runner) sit in every car behind the tinted glass, hands on their own wheels, turning it with you, and ride the bike tucked over the tank. Pick yours on the Driver tab; rivals get the others. See [docs/DRIVERS.md](docs/DRIVERS.md).
- **Money and crates**: races pay prize money (more for a win, a bigger field and a longer pass; solo races vs AI pay 60%). Upgrades only come from crates: a Mystery Crate (any part, a chance of +2 or a jackpot, or scrap or nothing) or a Tuner Crate (the part you pick, pricier per level). Buy more cars at the dealer.
- **Cosmetic cases**: paint jobs, decals, tints, lamps, rims, underglow, plates, exhaust tips and, from the **Aero Case**, bolt-on body parts: rear wings (up to a towering Bōsōzoku), hood scoops and superchargers, roof racks, light bars, surfboards and a lucky duck, front splitters and bull bars, side skirts and flares, mudflaps. Looks only, never handling.
- **Your garage follows your account** when you're signed in (it's stored on the server). Guests keep theirs in the browser.
- **Online**: Host a race (4-letter code, up to 8 racers, invite link `/?race=CODE`) or Join one from the list. The host picks the pass, Race or Time trial (ghost cars) and starts it. In a time trial the host also picks the **cars**: everyone's own, a **spec car** (one racer's car drawn at random, same model and upgrades for all, your own paint) or **maxed out** (your own car with every part at level 5).
- **Boost pads, no items**: there are no item boxes. Every track has a few small rainbow boost pads instead, a lane wide, on the outside of corner exits that open onto a straight: run wide over one and it fires you off the bend.
- **Ryūsei Expressway** (night highway street racing: four lanes of traffic all going your way, split the gaps at full speed) and **Hayate Flats** (a 22 m-wide desert speedway where no corner turns more than 30°, with four lanes of traffic heading your way: flat out if you hold the line). Both are in the **Velocity Cup**.
- **Futamata Parkway** (ten kilometres one way through the autumn hills, four lanes of traffic all going your way, long sweepers and four corners worth a brake; halfway down the road forks in two for 1.5 km, left through the valley or right over the ridge, and both ways are the same distance).
- **The Postcard Cup**: five town circuits raced back to back, the only five-round cup. Taketomi Island (Okinawa: coral lanes and red-tiled roofs, then a fast beach sweep), Hallstatt Shore (the lake village, a hairpin pair up the hill), Göreme Valley (Cappadocia at sunrise, fairy chimneys and a sky full of hot-air balloons), Oia Caldera (Santorini's clifftop at sunset, white houses and blue domes) and Chefchaouen Medina (the blue city's hairpins up the mountainside).
- **Kumo Skyway**: a road floating above the clouds with no walls at all. Run wide and you drop off the edge, lose all your speed and get put back in the middle of the road where you fell.
- **Free roam on Kanjo** (host a lobby and pick Free roam): an open-world island with a mountain, a harbour city and an expressway round it. No race and no clock: cruise, hang out at the harbour meet or the summit lookout, hit 300 km/h down the Bayshore straight or the old runway (speed traps time you), and thread the highway traffic for NEAR MISS chains. Friends can drop in while it's on; the pause menu jumps you to the meet, the lookout or the airfield.

| Controller | Keyboard | |
| --- | --- | --- |
| RT / LT | W / S (↑ ↓) | Throttle / brake (hold brake when stopped to reverse) |
| Left stick | A D (← →) | Steer |
| Ⓐ (hold) | Space (hold) | Drift; let go for a mini-turbo |
| Ⓧ / RB | E | Next car (spectating after you finish online) |
| D-pad ↑ ↓ | Shift / Ctrl | Shift up / down (manual gearbox) |
| Ⓨ | C | Camera (chase, near, hood, bumper) |
| LB (hold) | V (hold) | Look back |
| View | R | Reset to the road |
| Menu | Esc | Pause (assists, camera, volume) |

## Accounts

Optional and simple, for friends: open your player card (your name, top right) and pick **Sign in** to create an account with a username and password (usernames are 3-16 letters, numbers, `_` or `-`). Signed in, you always play under your username and nobody else can use it; guests can still play, but a guest who types a taken name shows up as "name (guest)". Change your password on the Account screen; if you forget it, ask Michael for a reset. See `docs/DEPLOYMENT.md` for how it works.
