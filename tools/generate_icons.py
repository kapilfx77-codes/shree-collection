"""
Generates the favicon / app-icon / OG-image set for Shree Collection.

Design is derived from the existing assets/favicon.svg and the CSS custom
properties in styles.css so the icons match the site exactly:
    --primary   #7A1C2C   (maroon ground)
    --gold      #C9A050   (gradient end)
    gold light  #E5C378   (gradient start)
Typeface is Georgia Bold, the declared fallback in favicon.svg's
font-family: 'Playfair Display', Georgia, serif.

Run:  python tools/generate_icons.py
Regenerate only if the brand colours or mark change.
"""

from PIL import Image, ImageDraw, ImageFont

PRIMARY = (122, 28, 44)       # #7A1C2C
GOLD_LIGHT = (229, 195, 120)  # #E5C378
GOLD = (201, 160, 80)         # #C9A050
CREAM = (250, 247, 242)       # #FAF7F2

GEORGIA_BOLD = "C:/Windows/Fonts/georgiab.ttf"
GEORGIA = "C:/Windows/Fonts/georgia.ttf"

SS = 4  # supersample factor for crisp edges


def gold_gradient(size):
    """Diagonal gold gradient, matching the SVG's 0%,0% -> 100%,100% linearGradient."""
    w, h = size
    grad = Image.new("RGB", (w, h))
    px = grad.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(w - 1, 1) + y / max(h - 1, 1)) / 2
            px[x, y] = (
                round(GOLD_LIGHT[0] + (GOLD[0] - GOLD_LIGHT[0]) * t),
                round(GOLD_LIGHT[1] + (GOLD[1] - GOLD_LIGHT[1]) * t),
                round(GOLD_LIGHT[2] + (GOLD[2] - GOLD_LIGHT[2]) * t),
            )
    return grad


def make_icon(px_size, radius_ratio=0.20, letter="S"):
    """Rounded maroon square with a gold-gradient letter, rendered at SSx then downsampled."""
    n = px_size * SS
    base = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * radius_ratio), fill=PRIMARY + (255,))

    # Letter mask
    font = ImageFont.truetype(GEORGIA_BOLD, int(n * 0.62))
    mask = Image.new("L", (n, n), 0)
    mdraw = ImageDraw.Draw(mask)
    bbox = mdraw.textbbox((0, 0), letter, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    mdraw.text(((n - tw) / 2 - bbox[0], (n - th) / 2 - bbox[1]), letter, font=font, fill=255)

    base.paste(gold_gradient((n, n)), (0, 0), mask)
    return base.resize((px_size, px_size), Image.LANCZOS)


def make_og():
    """1200x630 Open Graph card."""
    W, H = 1200, 630
    n_w, n_h = W * 2, H * 2
    img = Image.new("RGB", (n_w, n_h), PRIMARY)
    draw = ImageDraw.Draw(img)

    # Thin gold keyline
    m = 48 * 2
    draw.rectangle([m, m, n_w - m, n_h - m], outline=GOLD, width=3)

    f_title = ImageFont.truetype(GEORGIA_BOLD, 132)
    f_sub = ImageFont.truetype(GEORGIA, 52)
    f_meta = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 40)

    title = "SHREE COLLECTION"
    sub = "Sarees  ·  Kurtas  ·  Lehengas"
    meta = "Butwal, Nepal  —  Delivery across Nepal"

    GAP_TITLE_RULE, RULE_H, GAP_RULE_SUB, GAP_SUB_META = 58, 4, 56, 46

    bb_t = draw.textbbox((0, 0), title, font=f_title)
    bb_s = draw.textbbox((0, 0), sub, font=f_sub)
    bb_m = draw.textbbox((0, 0), meta, font=f_meta)
    h_t, h_s, h_m = bb_t[3] - bb_t[1], bb_s[3] - bb_s[1], bb_m[3] - bb_m[1]

    # Optically centre the whole block rather than pinning it to the top
    block_h = h_t + GAP_TITLE_RULE + RULE_H + GAP_RULE_SUB + h_s + GAP_SUB_META + h_m
    y = (n_h - block_h) / 2

    def centered(text, font, bb, top, fill):
        draw.text(((n_w - (bb[2] - bb[0])) / 2 - bb[0], top - bb[1]), text, font=font, fill=fill)

    # Gold-gradient wordmark
    tmask = Image.new("L", (n_w, n_h), 0)
    ImageDraw.Draw(tmask).text(
        ((n_w - (bb_t[2] - bb_t[0])) / 2 - bb_t[0], y - bb_t[1]), title, font=f_title, fill=255
    )
    img.paste(gold_gradient((n_w, n_h)), (0, 0), tmask)
    y += h_t + GAP_TITLE_RULE

    draw.rectangle([(n_w - 150) / 2, y, (n_w + 150) / 2, y + RULE_H], fill=GOLD)
    y += RULE_H + GAP_RULE_SUB

    centered(sub, f_sub, bb_s, y, CREAM)
    y += h_s + GAP_SUB_META
    centered(meta, f_meta, bb_m, y, (226, 205, 198))

    return img.resize((W, H), Image.LANCZOS)


if __name__ == "__main__":
    out = "assets/"

    # Multi-resolution .ico for legacy browsers / bookmarks
    make_icon(256).save(
        out + "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    make_icon(16).save(out + "favicon-16x16.png")
    make_icon(32).save(out + "favicon-32x32.png")
    # Apple wants no transparency and a slightly tighter radius (iOS masks it itself)
    make_icon(180, radius_ratio=0.0).convert("RGB").save(out + "apple-touch-icon.png")
    make_icon(192).save(out + "icon-192.png")
    make_icon(512).save(out + "icon-512.png")
    make_og().save(out + "og-image.png", optimize=True)

    print("Wrote favicon.ico, favicon-16x16, favicon-32x32, apple-touch-icon,")
    print("      icon-192, icon-512, og-image.png -> assets/")
