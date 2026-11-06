# Paints TŌGE's distant-scenery panoramas: public/race/backdrops/<theme>.webp.
#
# Each image is a seamless 360° strip (4096 x 1024, RGBA) of far-off scenery: ridges of mountains, mesas,
# headlands, hills or a city skyline, with haze between the layers and mist in the valleys. trackview.ts wraps
# it round a cylinder that follows the camera, behind the real terrain and in front of the physical sky, so
# the sky stays what the cars reflect and the picture only adds a horizon. Everything here is generated from
# noise, so the images are ours to ship.
#
#   python3 dev/backdrops.py            (needs numpy + Pillow with WebP)
#
# Geometry (keep in step with BACKDROP in src/toge/client/trackview.ts): row 0 is tan(elevation) = TOP,
# the last row is BOTTOM, linear in tan(elevation) because the cylinder's height is linear. Column 0 is
# azimuth 0 (+z) and azimuth grows with the column, the way three.js lays a CylinderGeometry's u.

import math
import os
import numpy as np
from PIL import Image

W, H = 4096, 1024
TOP, BOTTOM = 0.26, -0.06
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'race', 'backdrops')

# tan(elevation) of each row, and the azimuth (0..1) of each column
Y = TOP + (BOTTOM - TOP) * (np.arange(H) + 0.5) / H
U = (np.arange(W) + 0.5) / W


def srgb(hexstr):
    return np.array([int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def noise1(seed, beta=2.0, lo=2, hi=900):
    """Periodic 1-D fractal noise over the full circle, unit variance (FFT-filtered, so it wraps exactly)."""
    rng = np.random.default_rng(seed)
    f = np.fft.rfftfreq(W, 1 / W)
    amp = np.where((f >= lo) & (f <= hi), 1 / np.maximum(f, 1) ** (beta / 2), 0)
    spec = amp * (rng.normal(size=f.size) + 1j * rng.normal(size=f.size))
    n = np.fft.irfft(spec, W)
    return n / n.std()


def noise2(seed, beta=2.4, lo=3, sx=1.0, sy=1.0):
    """Periodic 2-D fractal noise (H x W), unit variance; sx/sy stretch the features."""
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(H, 1 / H)[:, None] * sy
    fx = np.fft.rfftfreq(W, 1 / W)[None, :] * sx * H / W
    r = np.sqrt(fx ** 2 + fy ** 2)
    amp = np.where(r >= lo, 1 / np.maximum(r, 1) ** (beta / 2), 0)
    spec = amp * (rng.normal(size=r.shape) + 1j * rng.normal(size=r.shape))
    n = np.fft.irfft2(spec, (H, W))
    return n / n.std()


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def az_light(sun_az):
    """How much a slope facing back at us is lit, by azimuth: in shadow looking into the sun, lit looking away."""
    d = 2 * math.pi * (U - sun_az / 360)
    return 0.5 - 0.5 * np.cos(d), np.sin(d)


class Canvas:
    def __init__(self):
        self.rgb = np.zeros((H, W, 3))
        self.a = np.zeros((H, W))

    def over(self, rgb, a):
        a = np.clip(a, 0, 1)[..., None]
        self.rgb = self.rgb * (1 - a) + rgb * a
        self.a = self.a + (1 - self.a) * a[..., 0]

    def ridge(self, h, color, haze, haze_amt, *, sun=None, shade=0.0, snow=None, speckle=None, mist=0.0):
        """A silhouette of height h (tan elevation, per column), filled down to the bottom.

        Lighter (hazier) toward its foot so valleys read as mist, lit or shadowed by its slope against the sun."""
        top = h[None, :]
        inside = smooth(-0.0012, 0.0012, top - Y[:, None])  # antialiased edge
        depth = np.clip((top - Y[:, None]) / 0.05, 0, 1)  # 0 at the crest, 1 well below it
        col = np.broadcast_to(color, (H, W, 3)).copy()
        if sun is not None:
            lit, side = sun
            # Slope over ~1.5° of azimuth, so the shading follows the faces, not every pixel of the crest.
            k_ = np.exp(-0.5 * (np.arange(-48, 49) / 16) ** 2)
            hs = np.convolve(np.concatenate([h[-48:], h, h[:48]]), k_ / k_.sum(), 'valid')
            slope = np.gradient(hs) * W / 40
            k = (0.75 + 0.5 * lit - 0.35 * shade) + shade * np.clip(-slope * side, -1, 1)
            col *= np.clip(k, 0.45, 1.5)[None, :, None]
        if snow is not None:
            line, snow_col = snow
            n = noise2(int(line * 1000) + 7, beta=2.6, sx=1.6, sy=0.6) * 0.012
            s = smooth(-0.004, 0.004, Y[:, None] - (line + n)) * smooth(0, 0.004, top - Y[:, None])
            col = col * (1 - s[..., None]) + snow_col * s[..., None]
        if speckle is not None:
            cols, amount, seed = speckle
            n = noise2(seed, beta=1.2, sx=2.5, sy=1.0)
            pick = (np.floor((noise2(seed + 1, beta=1.6) * 0.5 + 0.5) * len(cols)) % len(cols)).astype(int)
            pal = np.array(cols)[pick]
            m = (smooth(0.4, 1.4, n) * amount)[..., None]
            col = col * (1 - m) + pal * m
        # Every ridge's foot melts into the haze toward the horizon row, so where the strip meets the real terrain
        # (faded into the same fog colour, trackview.ts HORIZON_FADE) there's no hard straight line.
        foot = smooth(0.03, -0.012, Y)[:, None] ** 1.5
        h_amt = np.clip(np.maximum(haze_amt + mist * depth, foot), 0, 1)[..., None]
        col = col * (1 - h_amt) + haze * h_amt
        self.over(col, inside)

    def mist(self, y0, thick, color, alpha, seed):
        """A soft bank of low cloud lying across the strip."""
        n = noise2(seed, beta=2.8, sx=3.0, sy=0.5)
        band = np.exp(-(((Y[:, None] - y0) / thick) ** 2))
        a = band * smooth(-0.6, 1.2, n) * alpha
        self.over(np.broadcast_to(color, (H, W, 3)), a)

    def fill_below(self, color):
        """Below the horizon the strip is solid haze: past the real terrain's far edge the ground just fades
        into fog, rather than showing the bright sky under the horizon as a white sliver."""
        a = smooth(0.0, -0.016, Y)[:, None] * np.ones((1, W))
        self.over(np.broadcast_to(color, (H, W, 3)), a)

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        img = np.dstack([np.clip(self.rgb, 0, 1), np.clip(self.a, 0, 1)])
        im = Image.fromarray((img * 255 + 0.5).astype(np.uint8), 'RGBA')
        path = os.path.join(OUT, f'{name}.webp')
        im.save(path, 'WEBP', quality=82, method=6, alpha_quality=90)
        print(f'{path}: {os.path.getsize(path) // 1024} kB')


def peaks(seed, base, height, sharp=0.6, lo=3, hi=260):
    """Mountain ridgeline: ridged noise for sharp summits."""
    n = noise1(seed, beta=2.1, lo=lo, hi=hi)
    r = 1 - np.abs(np.tanh(n * 0.8))
    m = noise1(seed + 11, beta=2.6, lo=1, hi=8) * 0.5 + 0.5  # big massifs and gaps
    h = (r ** (1 + sharp * 2)) * 0.6 + (n * 0.15 + 0.4) * 0.4
    return base + height * h * np.clip(m, 0.15, 1.2)


def hills(seed, base, height, lo=2, hi=200):
    n = noise1(seed, beta=2.8, lo=lo, hi=hi)
    return base + height * (np.tanh(n * 0.7) * 0.5 + 0.5)


def mesas(seed, base, height):
    """Flat-topped buttes: terraced noise with steep sides."""
    n = noise1(seed, beta=2.4, lo=4, hi=300)
    gate = smooth(0.1, 0.35, noise1(seed + 5, beta=2.2, lo=6, hi=60))
    steps = np.floor(n * 1.6 + 2) / 4
    frac = (n * 1.6 + 2) % 1
    terr = steps + smooth(0.85, 1.0, frac) / 4  # cliffs between flat tops
    rough = noise1(seed + 9, beta=2.0, lo=60, hi=600) * 0.015
    return base + height * np.clip(terr, 0, 1.2) * gate + height * 0.08 * (np.tanh(noise1(seed + 3, 2.6, 1, 30)) + 1) + rough * height


# --- the themes. Colours are sRGB and shown as painted (the material's colour is white), so the haze each
# layer fades into and the solid band below the horizon are the track's fog colour (LOOKS in trackview.ts):
# far real terrain fades to that same colour, and the strip carries it on to the horizon without a seam. ----------------------------------------


def alpine():
    c = Canvas()
    sun = az_light(215)
    sky = srgb('a9bfd6')  # the scene's fog colour
    c.ridge(peaks(1, 0.012, 0.11, sharp=0.9), srgb('8f9fb8'), sky, 0.55, sun=sun, shade=0.4, snow=(0.06, srgb('f4f7fb')))
    c.mist(0.03, 0.012, srgb('e8edf4'), 0.5, 2)
    c.ridge(peaks(3, 0.004, 0.075, sharp=0.7), srgb('5f6f86'), sky, 0.35, sun=sun, shade=0.6, snow=(0.055, srgb('eef2f8')), mist=0.4)
    c.ridge(hills(5, -0.004, 0.035), srgb('2f4a33'), sky, 0.38, sun=sun, shade=0.3, mist=0.4,
            speckle=([srgb('1f3a26'), srgb('3a5a34')], 0.6, 6))
    c.fill_below(srgb('a9bfd6'))
    c.save('alpine')


def coast():
    c = Canvas()
    sun = az_light(250)
    haze = srgb('d8c8b4')  # the scene's fog colour
    # Low headlands and islands out on the sea; the sea itself reaches the horizon.
    c.ridge(hills(21, -0.006, 0.03, lo=6, hi=300) * smooth(-0.2, 0.6, noise1(22, 2.0, 3, 20))[:] - 0.004,
            srgb('9aa3a6'), haze, 0.55, sun=sun, shade=0.3)
    c.ridge(hills(23, -0.012, 0.04, lo=4, hi=300) * smooth(0.0, 0.8, noise1(24, 2.0, 2, 12)) - 0.002,
            srgb('5d6e5c'), haze, 0.35, sun=sun, shade=0.5, mist=0.4)
    c.mist(0.004, 0.006, srgb('efe6da'), 0.45, 25)
    c.fill_below(srgb('d8c8b4'))
    c.save('coast')


def desert():
    c = Canvas()
    sun = az_light(140)
    haze = srgb('e0b48a')  # the scene's fog colour
    c.ridge(peaks(31, 0.004, 0.05, sharp=0.3), srgb('b99a86'), haze, 0.6, sun=sun, shade=0.3)
    c.ridge(mesas(33, -0.004, 0.06), srgb('b0603a'), haze, 0.38, sun=sun, shade=0.7, mist=0.25)
    c.ridge(mesas(35, -0.01, 0.045), srgb('8e4127'), haze, 0.22, sun=sun, shade=0.8, mist=0.3)
    c.fill_below(srgb('e0b48a'))
    c.save('desert')


def night():
    c = Canvas()
    moon = az_light(120)
    haze = srgb('0b1120')  # the scene's fog colour
    c.ridge(peaks(41, 0.01, 0.09, sharp=0.8), srgb('2a3550'), haze, 0.4, sun=moon, shade=0.5, snow=(0.065, srgb('7d8aae')))
    c.ridge(hills(43, -0.004, 0.04), srgb('0d1320'), haze, 0.25, mist=0.3)
    # A town's lights along the foot of the hills.
    rng = np.random.default_rng(44)
    town = smooth(0.4, 1.0, noise1(45, 2.0, 2, 16))
    xs = rng.integers(0, W, 2600)
    keep = rng.random(xs.size) < town[xs]
    xs = xs[keep]
    ys = (rng.random(xs.size) ** 2 * 0.012 - 0.004)
    lights = np.zeros((H, W))
    rows = ((TOP - ys) / (TOP - BOTTOM) * H).astype(int)
    lights[np.clip(rows, 0, H - 1), xs] = rng.uniform(0.5, 1, xs.size)
    lights = np.maximum(lights, np.roll(lights, 1, 1) * 0.6)
    col = np.where(rng.random((H, W, 1)) < 0.7, srgb('ffc27a'), srgb('dfe8ff'))
    c.rgb = c.rgb * (1 - lights[..., None]) + col * lights[..., None]
    c.fill_below(srgb('0b1120'))
    c.save('night')


def autumn():
    c = Canvas()
    sun = az_light(200)
    haze = srgb('d9c7a8')  # the scene's fog colour
    c.ridge(peaks(51, 0.008, 0.07, sharp=0.5), srgb('8c8a96'), haze, 0.55, sun=sun, shade=0.3)
    c.mist(0.022, 0.01, srgb('f2e8d8'), 0.4, 52)
    c.ridge(hills(53, 0.0, 0.045), srgb('8a5a2c'), haze, 0.32, sun=sun, shade=0.5, mist=0.4,
            speckle=([srgb('b8461e'), srgb('d0892a'), srgb('6c6b2a'), srgb('9a2f1c')], 0.85, 54))
    c.ridge(hills(55, -0.008, 0.03), srgb('6b4322'), haze, 0.2, sun=sun, shade=0.5, mist=0.35,
            speckle=([srgb('c0501f'), srgb('e0a030'), srgb('5a5a22'), srgb('a83a1e')], 0.9, 56))
    c.fill_below(srgb('d9c7a8'))
    c.save('autumn')


def spring():
    c = Canvas()
    sun = az_light(160)
    haze = srgb('dcdfec')  # the scene's fog colour
    c.ridge(peaks(61, 0.01, 0.08, sharp=0.7), srgb('9aa6c0'), haze, 0.55, sun=sun, shade=0.3, snow=(0.07, srgb('f6f8fc')))
    c.mist(0.026, 0.01, srgb('f6f2f4'), 0.45, 62)
    c.ridge(hills(63, -0.002, 0.04), srgb('5c7a4a'), haze, 0.3, sun=sun, shade=0.4, mist=0.4,
            speckle=([srgb('f2c4d4'), srgb('e8a8c0'), srgb('86a860')], 0.55, 64))
    c.ridge(hills(65, -0.009, 0.028), srgb('4c6c3a'), haze, 0.18, sun=sun, shade=0.4, mist=0.35,
            speckle=([srgb('f6cad8'), srgb('ffffff'), srgb('7aa050')], 0.6, 66))
    c.fill_below(srgb('dcdfec'))
    c.save('spring')


def city():
    c = Canvas()
    haze = srgb('1b1730')  # the scene's fog colour
    rng = np.random.default_rng(71)
    c.ridge(hills(72, 0.0, 0.035, lo=2, hi=60), srgb('141224'), haze, 0.5)
    for layer, (base, tall, dark, hz, density) in enumerate([(0.0, 0.07, '1a1730', 0.55, 0.55), (-0.004, 0.1, '100e1d', 0.3, 0.75)]):
        h = np.full(W, -1.0)
        win = np.zeros((H, W))
        x = 0
        while x < W:
            w = int(rng.integers(14, 60))
            if rng.random() < density:
                top = base + tall * rng.random() ** 2.2 * (0.35 + 0.65 * (math.sin(x / W * 6.283 * 3 + layer) * 0.5 + 0.5))
                h[x:x + w] = np.maximum(h[x:x + w], top)
                if rng.random() < 0.15:  # a mast
                    m = x + w // 2
                    h[m:m + 2] = top + 0.008
                # Windows: a grid of lit cells, a few rows dark.
                r0 = int((TOP - top) / (TOP - BOTTOM) * H) + 3
                r1 = int((TOP - BOTTOM * 0 - 0) / (TOP - BOTTOM) * H)
                lit = rng.random() * 0.5 + 0.15
                for r in range(r0, min(r1, H), 4):
                    if rng.random() < 0.2:
                        continue
                    for cc in range(x + 2, min(x + w - 2, W), 4):
                        if rng.random() < lit:
                            win[r:r + 2, cc:cc + 2] = rng.uniform(0.35, 1.0)
            x += w + int(rng.integers(0, 6))
        c.ridge(np.where(h < 0, base - 0.01, h), srgb(dark), haze, hz)
        inside = (Y[:, None] < h[None, :]) & (Y[:, None] > -0.004)
        win *= inside
        col = np.where(rng.random((H, W, 1)) < 0.6, srgb('ffcf8a'), np.where(rng.random((H, W, 1)) < 0.5, srgb('9fd8ff'), srgb('ff7ad0')))
        k = (win * (1 - hz * 0.6))[..., None]
        c.rgb = c.rgb * (1 - k) + col * k
    c.fill_below(srgb('1b1730'))
    c.save('city')


if __name__ == '__main__':
    for f in (alpine, coast, desert, night, autumn, spring, city):
        f()
