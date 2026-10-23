#!/usr/bin/env python3
"""Draw the placeholder "little by little" app icons into app/assets/.

Until there's real logo artwork, the mark is typeset: a lowercase "lbl" in
DM Serif Display inside a Golden Honey ring, with the brand's twinkle. It
matches BrandMark in app/src/components/brand.tsx. Replace this script (and
those components) when the artwork arrives.

    python3 -m venv venv && ./venv/bin/pip install Pillow
    ./venv/bin/python make_icons.py
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).parent.parent
ASSETS = ROOT / "app/assets"
FONT = ROOT / "app/node_modules/@expo-google-fonts/dm-serif-display/400Regular/DMSerifDisplay_400Regular.ttf"

PAPER = (251, 248, 242, 255)
INK = (20, 23, 22, 255)
ACCENT = (212, 153, 74, 255)
SS = 4  # supersampling factor

# The twinkle from brand.tsx, in its 24-unit box: four cubic segments.
TWINKLE = [
    ((12, 1), (12.5, 7.5), (16.5, 11.5), (23, 12)),
    ((23, 12), (16.5, 12.5), (12.5, 16.5), (12, 23)),
    ((12, 23), (11.5, 16.5), (7.5, 12.5), (1, 12)),
    ((1, 12), (7.5, 11.5), (11.5, 7.5), (12, 1)),
]


def twinkle(cx, cy, size):
    pts = []
    for p0, p1, p2, p3 in TWINKLE:
        for i in range(24):
            t = i / 24
            u = 1 - t
            x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
            y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
            pts.append((cx + (x - 12) / 24 * size, cy + (y - 12) / 24 * size))
    return pts


def mark(px, scale, background, ink=INK, accent=ACCENT):
    """The mark centred on a px-square canvas; scale is the ring's diameter / px."""
    n = px * SS
    im = Image.new("RGBA", (n, n), background)
    d = ImageDraw.Draw(im)
    c = n / 2
    r = n * scale / 2
    d.ellipse((c - r, c - r, c + r, c + r), outline=accent, width=max(1, round(r * 0.035)))

    font = ImageFont.truetype(str(FONT), round(r * 0.78))
    text = "lbl"
    l, t, rr, b = d.textbbox((0, 0), text, font=font)
    tw, th = rr - l, b - t
    tx = c - tw / 2 - l - r * 0.06
    ty = c - th / 2 - t + r * 0.04
    d.text((tx, ty), text, font=font, fill=ink)
    d.polygon(twinkle(tx + l + tw + r * 0.2, c - th * 0.35, r * 0.36), fill=accent)
    return im.resize((px, px), Image.LANCZOS)


def main():
    clear = (0, 0, 0, 0)
    white = (255, 255, 255, 255)
    mark(1024, 0.68, PAPER).convert("RGB").save(ASSETS / "icon.png")
    mark(1024, 0.55, white).save(ASSETS / "splash-icon.png")
    mark(192, 0.86, PAPER).save(ASSETS / "favicon.png")
    # Android adaptive icons are cropped to a circle of ~66% — keep inside it.
    mark(512, 0.56, clear).save(ASSETS / "android-icon-foreground.png")
    mark(432, 0.56, clear, ink=white, accent=white).save(ASSETS / "android-icon-monochrome.png")


if __name__ == "__main__":
    main()
