#!/usr/bin/env python3
"""Regenerate the app/Dock icon set from the tray `idle` mark.

    python3 agent/scripts/build-app-icons.py [--preview]

Why this exists
---------------
The app icon shipped as a double-ring glyph that was never Curfew's mark
(2026-08-17, Arjun: "I do not want the double ring anywhere"). The real mark is
the vinyl record drawn for the menu bar — `icons/tray/{dark,light}/idle.png`.

Those tray files are only 50x50, which is far too small to scale up to the
1024px an `.icns` wants, so this script does NOT upscale them. It re-draws the
same mark from measured geometry, at whatever size is asked for, with 4x
supersampling. The numbers below were read off `tray/dark/idle.png` pixel by
pixel and are expressed as fractions of that 50px canvas, so the proportions
are the original's even though every pixel here is new:

    outer ring   centre (24.5, 24.5), mid radius 21.0, stroke 3.2
    centre ring  same centre,          mid radius  4.0, stroke 3.0
    groove arcs  same centre,          mid radius 12.7, stroke 3.4,
                 spanning 173deg->228deg and 353deg->48deg
                 (180deg apart — the mark is rotationally symmetric)

If the tray mark is ever redrawn, re-measure and update these constants; there
is no automatic link between the two.

The plate
---------
A bare glyph cannot be an app icon: the tray art is white-on-transparent, which
disappears on a light desktop, and its black counterpart disappears on a dark
one. So the mark sits on an opaque rounded-square plate in the Abyss palette,
which is also what makes it read as a Curfew icon next to the web app. macOS
Big Sur+ expects the plate inset from the canvas edge rather than bleeding to
it, hence PLATE_INSET.
"""

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ICONS = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
SS = 4  # supersample factor

# Measured from tray/dark/idle.png, as fractions of its 50px canvas.
U = 1 / 50
C = 24.5 * U
RING_R, RING_W = 21.0 * U, 3.2 * U
HUB_R, HUB_W = 4.0 * U, 3.0 * U
ARC_R, ARC_W = 12.7 * U, 3.4 * U
ARCS = [(173, 228), (353, 408)]  # 408 == 48 + 360, kept unwrapped for pieslice

# Abyss palette, matching web/app/tokens.css.
PLATE_TOP = (22, 40, 58)      # --color-abyss-hairline
PLATE_BOTTOM = (4, 6, 10)     # --color-abyss-base
MARK = (234, 243, 248)        # --color-abyss-text
PLATE_INSET = 0.06
PLATE_RADIUS = 0.225          # macOS squircle approximation
# The mark fills its whole 50px canvas in the tray, where it needs every pixel.
# Reproduced at that scale inside the plate it reads as cramped — the outer
# ring lands within a hair of the plate edge. Real app icons keep the art
# comfortably inset, so the mark is scaled about its own centre.
MARK_SCALE = 0.76


def draw(size: int) -> Image.Image:
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # Plate: vertical gradient, then masked to a rounded square.
    grad = Image.new("RGBA", (n, n))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        t = y / max(n - 1, 1)
        gd.line(
            [(0, y), (n, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(PLATE_TOP, PLATE_BOTTOM)) + (255,),
        )
    mask = Image.new("L", (n, n), 0)
    ins = PLATE_INSET * n
    ImageDraw.Draw(mask).rounded_rectangle(
        [ins, ins, n - ins, n - ins], radius=PLATE_RADIUS * n, fill=255
    )
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)

    def ring(mid_r: float, width: float):
        r, w = mid_r * MARK_SCALE * n, width * MARK_SCALE * n
        cx = cy = n / 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=MARK + (255,), width=round(w))

    ring(RING_R, RING_W)
    ring(HUB_R, HUB_W)
    for start, end in ARCS:
        r, w = ARC_R * MARK_SCALE * n, ARC_W * MARK_SCALE * n
        cx = cy = n / 2
        d.arc([cx - r, cy - r, cx + r, cy + r], start, end, fill=MARK + (255,), width=round(w))

    return img.resize((size, size), Image.LANCZOS)


PNGS = {
    "icon.png": 512,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "32x32.png": 32,
    "StoreLogo.png": 50,
    **{f"Square{s}x{s}Logo.png": s for s in (30, 44, 71, 89, 107, 142, 150, 284, 310)},
}


def main() -> int:
    if "--preview" in sys.argv:
        out = Path("/tmp/curfew-app-icon-preview.png")
        sheet = Image.new("RGBA", (16 + 512 + 16 + 128 + 16, 544), (150, 150, 150, 255))
        sheet.paste(draw(512), (16, 16))
        sheet.paste(draw(128), (16 + 512 + 16, 16))
        sheet.paste(draw(32), (16 + 512 + 16, 160))
        sheet.save(out)
        print(f"preview -> {out}")
        return 0

    for name, size in PNGS.items():
        draw(size).save(ICONS / name)
        print(f"wrote {name} ({size}px)")

    # .ico — Windows, multi-resolution in one file.
    draw(256).save(ICONS / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("wrote icon.ico")

    # .icns — via iconutil, the only supported way to build a real macOS icon.
    iconset = ICONS / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    for base in (16, 32, 128, 256, 512):
        draw(base).save(iconset / f"icon_{base}x{base}.png")
        draw(base * 2).save(iconset / f"icon_{base}x{base}@2x.png")
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(ICONS / "icon.icns")], check=True
    )
    for f in iconset.iterdir():
        f.unlink()
    iconset.rmdir()
    print("wrote icon.icns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
