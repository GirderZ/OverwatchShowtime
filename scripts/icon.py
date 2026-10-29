"""Build a small geometric application mark with only the Python standard library."""
import math
import struct
import zlib
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'assets'
root.mkdir(exist_ok=True)

def png(size):
    scale = 4
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            values = [0, 0, 0, 0]
            for j in range(scale):
                for i in range(scale):
                    px = (x + (i + .5) / scale) / size
                    py = (y + (j + .5) / scale) / size
                    qx, qy = abs(px - .5) - .31, abs(py - .5) - .31
                    inside = max(qx, 0)**2 + max(qy, 0)**2 < .15**2
                    color = (37, 50, 70, 255) if inside else (0, 0, 0, 0)
                    r = math.hypot(px - .5, py - .5)
                    angle = math.atan2(py - .5, px - .5)
                    ring = .285 < r < .355 and not (-2.6 < angle < -.54)
                    top = .285 < r < .355 and -2.22 < angle < -.92
                    def segment(ax, ay, bx, by):
                        dx, dy = bx - ax, by - ay
                        t = max(0, min(1, ((px-ax)*dx + (py-ay)*dy) / (dx*dx+dy*dy)))
                        return math.hypot(px-ax-t*dx, py-ay-t*dy) < .032
                    hand = segment(.5,.3,.5,.54) or segment(.5,.54,.68,.69) or segment(.32,.69,.5,.54)
                    if ring or hand:
                        color = (245, 248, 252, 255)
                    if top or math.hypot(px-.5,py-.54) < .035:
                        color = (250, 158, 49, 255)
                    for k in range(4): values[k] += color[k]
            pixels.extend(round(v / (scale*scale)) for v in values)
    def chunk(name, data):
        return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')

(root / 'icon.png').write_bytes(png(256))
(root / 'tray.png').write_bytes(png(32))
icon_data = png(256)
(root / 'icon.ico').write_bytes(struct.pack('<3H', 0, 1, 1) + struct.pack('<4B2H2I', 0, 0, 0, 0, 1, 32, len(icon_data), 22) + icon_data)

for theme, ink in [('light', '#263347'), ('dark', '#edf2fa')]:
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M16 13a25 25 0 0 1 32 0" stroke="#f59a35" stroke-width="6"/><path d="M10.5 20a25 25 0 1 0 43 0" stroke="{ink}" stroke-width="6"/><path d="M32 18v17l13 10M19 45l13-10" stroke="{ink}" stroke-width="5" stroke-linecap="square" stroke-linejoin="round"/><circle cx="32" cy="35" r="3" fill="#f59a35"/></svg>'
    (root / f'logo-{theme}.svg').write_text(svg)
