#!/usr/bin/env python3
"""Regenerate the social-share and home-screen art (launch checklist §1.5).

    python3 web/scripts/og-assets.py            # writes into web/app/

Outputs, both consumed by Next's file conventions (no metadata wiring — the
presence of the file IS the wiring, which is why they live in `app/` and not
`public/`):

    app/opengraph-image.jpg   1200x630, the unfurl card for every route
    app/apple-icon.png        180x180, the iOS home-screen mark

This is a ONE-OFF regenerator, deliberately not part of `next build`. It needs
Python with Pillow, fontTools and brotli, none of which the web toolchain has
any other reason to know about, and the inputs change about once a quarter.
Run it when the wordmark, the booth photograph, or the headline changes; commit
the output. The alternative — Next's `ImageResponse` at request time — was
declined for exactly one reason: satori cannot read woff2, and Clash Display
ships from Fontshare as a woff2 only (app/fonts/ClashDisplay-Variable.woff2),
so a runtime card would have had to fall back to a face that is not ours.

Every input is already in the repo and already shipped:
  - public/landing/booth.jpg          the room, pushed back into atmosphere
  - public/brand/curfew-wordmark.png  the mask PNG landing.css inks
  - public/favicon-dark.png           the record glyph, white-on-transparent
  - app/fonts/ClashDisplay-Variable.woff2   the marketing display face (D-4)

Colors are the Abyss tokens read out of app/tokens.css by hand — this file is
outside the CSS pipeline, so they are duplicated here rather than imported. If
the palette moves, move them here too.
"""
from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFilter, ImageFont

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "app"

W, H = 1200, 630

ABYSS = (4, 6, 10)        # --color-abyss-base
INK = (234, 243, 248)     # --color-abyss-text
CYAN = (127, 216, 242)    # --color-abyss-accent
CYAN_SOFT = (79, 178, 214)  # --color-abyss-accent-soft
CREST = (207, 238, 255)   # --landing-ribbon-crest


def clash(weight: int, size: int) -> ImageFont.FreeTypeFont:
    """A static instance of the variable display face at `weight`."""
    font = TTFont(WEB / "app" / "fonts" / "ClashDisplay-Variable.woff2")
    instancer.instantiateVariableFont(font, {"wght": weight}, inplace=True)
    font.flavor = None  # woff2 in, plain TTF out — FreeType reads that
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size)


def ink_mask(path: Path, width: int, rgb: tuple[int, int, int], opacity: float) -> Image.Image:
    """Tint a mask PNG (white-on-transparent) the way landing.css inks it."""
    mask = Image.open(path).convert("RGBA")
    size = (width, round(width * mask.height / mask.width))
    mask = mask.resize(size, Image.LANCZOS)
    out = Image.new("RGBA", size, rgb + (255,))
    out.putalpha(mask.getchannel("A").point(lambda a: int(a * opacity)))
    return out


def opengraph_image() -> Image.Image:
    # ── ground: the booth photograph, pushed back into atmosphere ─────────
    src = Image.open(WEB / "public" / "landing" / "booth.jpg").convert("RGB")
    crop_h = int(src.width / (W / H))
    top = int((src.height - crop_h) * 0.30)  # keeps the laptop, drops the ceiling
    base = src.crop((0, top, src.width, top + crop_h)).resize((W, H), Image.LANCZOS)

    base = Image.blend(base, base.convert("L").convert("RGB"), 0.35)
    base = Image.blend(base, Image.new("RGB", (W, H), ABYSS), 0.62)
    base = base.filter(ImageFilter.GaussianBlur(1.2))

    # Left-to-right scrim: solid ground under the type, photograph on the right.
    # An unfurl is read at thumbnail size in a feed, so the copy needs a real
    # floor rather than a translucent one.
    scrim = Image.new("L", (W, 1))
    for x in range(W):
        scrim.putpixel((x, 0), int(min(255, 250 * (1 - x / W) ** 1.6 + 40)))
    base = Image.composite(Image.new("RGB", (W, H), ABYSS), base, scrim.resize((W, H)))

    vign = Image.new("L", (1, H))
    for y in range(H):
        vign.putpixel((0, y), int(150 * max(0.0, (y / H - 0.62) / 0.38) ** 1.6))
    base = Image.composite(Image.new("RGB", (W, H), ABYSS), base, vign.resize((W, H)))

    img = base.convert("RGBA")

    # ── the energy arc — the product's own identity line ──────────────────
    # Held in the bottom band, clear of the type. In the first draft it ran
    # through the headline and struck a word out, which at thumbnail size reads
    # as a rendering fault rather than a graphic.
    arc_y = 552
    pts = []
    for x in range(0, W + 1, 3):
        t = x / W
        pts.append((
            x,
            arc_y
            - 30 * math.sin(t * math.pi * 1.15)
            - 20 * math.sin(t * math.pi * 3.4 + 0.6)
            - 46 * math.exp(-((t - 0.84) ** 2) / 0.010)   # the peak, over the laptop
            + 13 * math.sin(t * math.pi * 6.2 + 1.4),
        ))

    # Fades in from the left margin so the line enters the frame rather than
    # being cut off by it.
    ramp = Image.new("L", (W, 1))
    for x in range(W):
        ramp.putpixel((x, 0), int(255 * min(1.0, max(0.0, (x - 40) / 260))))
    ramp = np.asarray(ramp.resize((W, H)), dtype=float)

    def arc(fill: tuple[int, int, int, int], width: int, blur: float) -> Image.Image:
        # Supersampled 4x: PIL's polyline is not antialiased, and a 3px curve
        # drawn straight to the canvas reads as a dotted line.
        ss = 4
        big = Image.new("RGBA", (W * ss, H * ss), (0, 0, 0, 0))
        ImageDraw.Draw(big).line(
            [(x * ss, y * ss) for x, y in pts], fill=fill, width=width * ss, joint="curve"
        )
        layer = big.resize((W, H), Image.LANCZOS)
        if blur:
            layer = layer.filter(ImageFilter.GaussianBlur(blur))
        alpha = np.asarray(layer.getchannel("A"), dtype=float) * ramp / 255
        layer.putalpha(Image.fromarray(alpha.astype("uint8")))
        return layer

    for fill, width, blur in (
        (CYAN_SOFT + (210,), 14, 26),   # halo
        (CYAN + (190,), 6, 9),          # body
        (CREST + (255,), 3, 0.4),       # lit crest
    ):
        img = Image.alpha_composite(img, arc(fill, width, blur))

    # ── mark and type ─────────────────────────────────────────────────────
    img.alpha_composite(
        ink_mask(WEB / "public" / "brand" / "curfew-wordmark.png", 262, INK, 0.95), (80, 74)
    )

    draw = ImageDraw.Draw(img)
    head = clash(600, 68)
    # The landing's own two statements, in its own display face — the page and
    # the card open on the same sentence.
    draw.text((80, 214), "Every set has a shape.", font=head, fill=INK + (255,))
    draw.text((80, 294), "You have never seen yours.", font=head, fill=INK + (255,))
    draw.text(
        (80, 400),
        "The archive builds itself while you play.",
        font=clash(500, 27),
        fill=INK + (175,),
    )
    draw.text((80, 452), "curfew.vip", font=clash(600, 25), fill=CYAN + (255,))

    return img.convert("RGB")


def apple_icon(size: int = 180) -> Image.Image:
    """The home-screen mark: the record glyph on Abyss ground.

    Opaque and full-bleed on purpose — iOS composites this onto the home screen
    with its own rounding and no transparency handling, so a transparent PNG
    lands as a black square with a glyph knocked out of it.
    """
    img = Image.new("RGB", (size, size), ABYSS)

    # A soft off-center lift, so the tile is not a flat black square next to
    # every other flat black icon.
    lift = Image.new("L", (size, size))
    px = lift.load()
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - size * 0.34, y - size * 0.28) / (size * 0.85)
            px[x, y] = int(255 * max(0.0, 1 - d) ** 2.2)
    img = Image.composite(Image.new("RGB", (size, size), (16, 34, 48)), img, lift)

    glyph = ink_mask(WEB / "public" / "favicon-dark.png", round(size * 0.58), INK, 1.0)
    out = img.convert("RGBA")
    out.alpha_composite(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))
    return out.convert("RGB")


if __name__ == "__main__":
    og = OUT / "opengraph-image.jpg"
    opengraph_image().save(og, quality=88, optimize=True, progressive=True)
    print(f"wrote {og.relative_to(WEB.parent)} ({og.stat().st_size // 1024} KB)")

    icon = OUT / "apple-icon.png"
    apple_icon().save(icon, optimize=True)
    print(f"wrote {icon.relative_to(WEB.parent)} ({icon.stat().st_size // 1024} KB)")
