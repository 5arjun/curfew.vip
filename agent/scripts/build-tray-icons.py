#!/usr/bin/env python3
"""Generate the menu bar / system tray icons from the Curfew mark.

    python3 agent/scripts/build-tray-icons.py

Writes twelve PNGs — six states x two themes — into
`agent/src-tauri/icons/tray/{light,dark}/`, which `src/tray.rs` compiles in
with `include_image!`. Run it after changing `icons/icon.png` or any shape
here; the output is deterministic, so a run with no input change produces a
no-op diff.

Why monochrome
--------------
A menu bar icon is not a logo slot. It sits at 22pt against a background the
DJ controls (light bar, dark bar, and on macOS a desktop picture showing
through a translucent bar), so the only thing that survives is *shape*. The
first attempt rendered the mark in full colour and measured 9.33:1 mean
contrast on a dark menu bar but **1.68:1 on a light one** — the amber ring
washed out to nearly nothing on white. Apple's own guidance, and every
first-party menu bar item, is a single-colour silhouette for exactly this
reason. So the mark is drawn as a silhouette: black for a light menu bar
(`light/`), white for a dark one (`dark/`).

The mark survives that reduction because its identity is geometric, not
chromatic — two interlocking rings, each with a dot. The gaps that make them
read as *interlocking* are transparent in `icon.png`, so they stay transparent
here and the menu bar shows through them. That is what keeps the interlock
legible at 22pt; filling them would collapse the mark into a blob.

State badges
------------
Five of the six states carry a badge in the bottom-right corner; `idle` is the
bare mark, because the common case should be the quiet one. A badge is a
filled disc with its glyph **knocked out** rather than drawn on top: the
knockout shows the menu bar itself, so it has the same contrast as the
silhouette in both themes and needs no second colour. A transparent halo is
erased around each badge so it separates from the mark underneath.

The mark stays the same size in every state — only the badge changes — so
switching state never looks like the icon resized.

Glyphs are deliberately blunt, because 22px of badge is not enough for
detail: an up arrow for uploading, three dots for a queue, a bang for a
failure, a slash for a missing drive, two bars for paused.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

# Output geometry. 50px matches what `tray.rs` already ships, which is a
# comfortable @2x for a 22pt menu bar item with room left for the badge.
CANVAS = 50
# 1px of breathing room; a mark flush to the edge looks cramped next to the
# system items beside it.
MARK_INSET = 1
BADGE_CENTER = (37.5, 37.5)
BADGE_RADIUS = 11.0
# The transparent gap erased around the badge, separating it from the mark.
BADGE_HALO = 2.5
# Everything is drawn at 8x and downscaled once at the end: PIL has no
# antialiased primitives, and a menu bar icon shows every jagged edge.
SS = 8

THEMES = {"light": (0, 0, 0), "dark": (255, 255, 255)}
STATES = ("idle", "syncing", "queued", "failed", "drive-not-connected", "format-drift-paused")


def mark_silhouette(source: Path, fill: tuple[int, int, int]) -> Image.Image:
    """The Curfew mark as a single-colour silhouette, at supersampled size.

    `icon.png`'s alpha channel *is* the silhouette — the artwork is two solid
    colours on full transparency, with the interlock gaps already transparent —
    so this is a tint of the alpha, never a threshold over RGB. That means a
    future edit to the mark's colours changes nothing here, and an edit to its
    shape is picked up exactly.
    """
    mark = Image.open(source).convert("RGBA")
    size = (CANVAS - 2 * MARK_INSET) * SS
    alpha = mark.getchannel("A").resize((size, size), Image.LANCZOS)

    silhouette = Image.new("RGBA", (CANVAS * SS, CANVAS * SS), (0, 0, 0, 0))
    tinted = Image.new("RGBA", (size, size), (*fill, 255))
    tinted.putalpha(alpha)
    silhouette.paste(tinted, (MARK_INSET * SS, MARK_INSET * SS))
    return silhouette


def erase_disc(image: Image.Image, center: tuple[float, float], radius: float) -> None:
    """Punch a transparent disc through `image` — the halo around a badge.

    Drawing a transparent colour would *blend* rather than clear, so this
    works on the alpha channel directly: `darker` is a pixel-wise minimum, so
    alpha only ever goes down, and the disc's own antialiased edge carries
    through to the result.
    """
    cx, cy = center[0] * SS, center[1] * SS
    r = radius * SS
    hole = Image.new("L", image.size, 255)
    ImageDraw.Draw(hole).ellipse((cx - r, cy - r, cx + r, cy + r), fill=0)
    image.putalpha(ImageChops.darker(image.getchannel("A"), hole))


def knockout(draw_glyph, badge: Image.Image) -> None:
    """Clear `draw_glyph`'s shape out of `badge`, showing the menu bar through.

    The glyph is drawn white-on-black into a mask and inverted, so the same
    minimum-with-alpha trick applies: where the glyph is solid the badge goes
    fully transparent, and its antialiased edge softens the alpha instead of
    hard-cutting it.
    """
    mask = Image.new("L", badge.size, 0)
    draw_glyph(ImageDraw.Draw(mask))
    badge.putalpha(ImageChops.darker(badge.getchannel("A"), ImageChops.invert(mask)))


def _bar(d, cx: float, cy: float, w: float, h: float, fill=255) -> None:
    """A rounded vertical bar in supersampled coordinates."""
    x0, y0 = (cx - w / 2) * SS, (cy - h / 2) * SS
    x1, y1 = (cx + w / 2) * SS, (cy + h / 2) * SS
    d.rounded_rectangle((x0, y0, x1, y1), radius=(w / 2) * SS, fill=fill)


def _dot(d, cx: float, cy: float, r: float, fill=255) -> None:
    d.ellipse(((cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS), fill=fill)


def glyph_syncing(d) -> None:
    """An up arrow: sync is an upload, and an arrow reads at any size."""
    cx, cy = BADGE_CENTER
    _bar(d, cx, cy + 1.4, 2.4, 7.2)
    d.polygon(
        [
            ((cx - 4.6) * SS, (cy - 0.9) * SS),
            ((cx + 4.6) * SS, (cy - 0.9) * SS),
            (cx * SS, (cy - 6.2) * SS),
        ],
        fill=255,
    )


def glyph_queued(d) -> None:
    """Three dots — waiting, in the universal shorthand."""
    cx, cy = BADGE_CENTER
    for dx in (-4.2, 0.0, 4.2):
        _dot(d, cx + dx, cy, 1.5)


def glyph_failed(d) -> None:
    """A bang. Not a cross: a cross reads as "closed"/"dismissed"."""
    cx, cy = BADGE_CENTER
    _bar(d, cx, cy - 1.4, 2.4, 7.0)
    _dot(d, cx, cy + 4.4, 1.5)


def glyph_drive_not_connected(d) -> None:
    """A slash — the drive the DJ's library lives on is not there."""
    cx, cy = BADGE_CENTER
    d.line(
        [((cx - 4.4) * SS, (cy + 4.4) * SS), ((cx + 4.4) * SS, (cy - 4.4) * SS)],
        fill=255,
        width=int(2.6 * SS),
    )


def glyph_format_drift_paused(d) -> None:
    """Two bars. Paused, not broken — capture stopped on purpose."""
    cx, cy = BADGE_CENTER
    _bar(d, cx - 2.4, cy, 2.4, 9.0)
    _bar(d, cx + 2.4, cy, 2.4, 9.0)


GLYPHS = {
    "syncing": glyph_syncing,
    "queued": glyph_queued,
    "failed": glyph_failed,
    "drive-not-connected": glyph_drive_not_connected,
    "format-drift-paused": glyph_format_drift_paused,
}


def build(source: Path, state: str, fill: tuple[int, int, int]) -> Image.Image:
    image = mark_silhouette(source, fill)

    if state in GLYPHS:
        # Halo first, then the badge lands in the cleared space.
        erase_disc(image, BADGE_CENTER, BADGE_RADIUS + BADGE_HALO)

        badge = Image.new("RGBA", image.size, (0, 0, 0, 0))
        cx, cy = BADGE_CENTER[0] * SS, BADGE_CENTER[1] * SS
        r = BADGE_RADIUS * SS
        ImageDraw.Draw(badge).ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*fill, 255))
        knockout(GLYPHS[state], badge)
        image = Image.alpha_composite(image, badge)

    return image.resize((CANVAS, CANVAS), Image.LANCZOS)


def main() -> int:
    icons = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
    source = icons / "icon.png"
    if not source.exists():
        print(f"error: {source} not found", file=sys.stderr)
        return 1

    for theme, fill in THEMES.items():
        out_dir = icons / "tray" / theme
        out_dir.mkdir(parents=True, exist_ok=True)
        for state in STATES:
            path = out_dir / f"{state}.png"
            build(source, state, fill).save(path, optimize=True)
            print(f"wrote {path.relative_to(icons.parent.parent.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
