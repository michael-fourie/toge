# Boys Day art (Blender)

The models are built by script in Blender (5.x), not by hand: `build.py` makes every asset as one mesh with vertex
colours (no textures), using the helpers in `lib.py`, and exports them all to one `boys-day.glb` plus preview renders.

To rebuild: copy this folder somewhere, set `HERE` in `bridge.py` to that path, and in Blender's Scripting workspace
run `exec(open('<that path>/bridge.py').read())` in the Python console. While Blender stays open it re-runs `build.py`
every time the file changes and writes the result to `log.txt`.

Status: a first batch (zombie parts, trees, rocks, cactus, mushroom, crystal, pumpkin, crate, jerry can). Not wired
into the game yet.
