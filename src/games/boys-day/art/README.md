# Boys Day art (Blender)

The models are built by script in Blender (5.x), not by hand: `build.py` makes every asset as one mesh with vertex
colours (no textures), using the helpers in `lib.py`, and exports them all to one `boys-day.glb` plus preview renders.

To rebuild: copy this folder somewhere, set `HERE` in `bridge.py` to that path, and in Blender's Scripting workspace
run `exec(open('<that path>/bridge.py').read())` in the Python console. While Blender stays open it re-runs `build.py`
every time the file changes and writes the result to `log.txt`.

In the game (`../assets.ts`): the zombie's parts (near white: each zombie is tinted by skin and shirt), trees and pines
(a trunk and a crown tinted by the world), dead trees, rocks, cacti, crates, jerry cans and the five guns. Still built
in code: the bus, the boys, the buildings, mushrooms and crystals (they glow).

Blender is Z up with the front at +Y; the export turns that into the game's Y up, front at -Z. Model at game scale
(metres), with origins where the game pivots: the ground for scenery, the shoulder and hip for limbs, the centre for
the zombie's body and head.
