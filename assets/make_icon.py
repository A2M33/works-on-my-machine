"""Draw the plugin icon (1024x1024) in the A2M33 trace look.

Two pads joined by a 45-degree trace: the left one lit with a check (works),
the right one an outline with a fault dot (fails). Idea sketched with Gemini,
redrawn here so colours are exact and nothing is watermarked.
Run: python make_icon.py  -> icon.png next to this file.
"""
from pathlib import Path
from PIL import Image, ImageDraw

S = 4  # supersample for smooth edges
W = 1024 * S
GROUND, TRACE, SIGNAL, FAULT = "#0b1222", "#3a4d70", "#2fcbea", "#c9343a"

img = Image.new("RGB", (W, W), GROUND)
d = ImageDraw.Draw(img)

pad, r, gap_y = 300 * S, 56 * S, 362 * S
lx, rx = 120 * S, W - 120 * S - pad
cy = gap_y + pad // 2

# trace: out of the left pad, 45-degree dip, into the right pad
t = 26 * S
x0, x1 = lx + pad, rx
mid = (x0 + x1) // 2
pts = [(x0, cy - 20 * S), (mid - 60 * S, cy - 20 * S), (mid + 20 * S, cy + 60 * S), (x1, cy + 60 * S)]
d.line(pts, fill=TRACE, width=t, joint="curve")

# left pad: lit, check mark cut out
d.rounded_rectangle([lx, gap_y, lx + pad, gap_y + pad], radius=r, fill=SIGNAL)
cw = 34 * S
check = [(lx + 88 * S, cy + 4 * S), (lx + 134 * S, cy + 52 * S), (lx + 214 * S, cy - 50 * S)]
d.line(check, fill=GROUND, width=cw, joint="curve")
for (x, y) in (check[0], check[-1]):
    d.ellipse([x - cw // 2, y - cw // 2, x + cw // 2, y + cw // 2], fill=GROUND)

# right pad: outline only, fault dot
ow = 30 * S
d.rounded_rectangle([rx, gap_y, rx + pad, gap_y + pad], radius=r, outline=SIGNAL, width=ow)
dot = 30 * S
dx, dy = rx + pad - 70 * S, gap_y + 70 * S
d.ellipse([dx - dot, dy - dot, dx + dot, dy + dot], fill=FAULT)

out = Path(__file__).with_name("icon.png")
img.resize((1024, 1024), Image.LANCZOS).save(out, optimize=True)
print(out)
