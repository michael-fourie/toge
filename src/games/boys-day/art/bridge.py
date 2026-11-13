# Boys Day art bridge: while Blender is open, re-runs build.py from this folder whenever it changes and writes
# what happened to log.txt. Started once from Blender's Python console; it stops when Blender quits.
import bpy, os, traceback

HERE = '/Users/shota/Public/boys-day-art'
_state = {'seen': 0.0}

def _tick():
    path = os.path.join(HERE, 'build.py')
    try:
        m = os.path.getmtime(path)
    except OSError:
        return 1.0
    if m == _state['seen']:
        return 1.0
    _state['seen'] = m
    log = os.path.join(HERE, 'log.txt')
    try:
        open(log, 'w').write('RUNNING\n')
        exec(compile(open(path).read(), 'build.py', 'exec'), {'__name__': '__main__', 'HERE': HERE})
        open(log, 'a').write('OK\n')
    except Exception:
        open(log, 'a').write(traceback.format_exc() + '\nFAILED\n')
    return 1.0

bpy.app.timers.register(_tick, first_interval=0.5, persistent=True)
print('Boys Day bridge running: watching', HERE)
