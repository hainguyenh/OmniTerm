"""Build the empty-pane cat art from scripts/assets/boring_cat.gif.

Run: python scripts/make-cat-assets.py   (needs Pillow)

The source is a 2048x2048 GIF whose cat occupies barely a quarter of the canvas, with GIF's 1-bit
alpha (hard, aliased edges). Both problems are fixed here rather than in CSS:

  * crop to the union of every frame's content box, so the art fills the box the UI gives it and
    WaitingPane needs no magic offsets;
  * convert palette -> RGBA before downscaling, so LANCZOS resampling produces a soft alpha edge.

Two variants are written, matching the loadingCat*.webp pair the app already ships: the source cat is
near-black and reads on a light UI, so it becomes the LIGHT-mode art, and the dark-mode art is its
value inversion. Only near-neutral pixels are inverted, so coloured accents (the cat's teal eyes) stay
themselves instead of turning brown.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageSequence

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "scripts" / "assets" / "boring_cat.gif"
OUT_LIGHT = ROOT / "src" / "assets" / "boringCatLight.webp"
OUT_DARK = ROOT / "src" / "assets" / "boringCatDark.webp"

# Rendered at ~110-320 CSS px (see WaitingPane); 640 keeps it crisp on a 2x display without the
# 12-frame animation ballooning past the ~600 KB the existing art costs.
TARGET_WIDTH = 640
# Breathing room around the content box, as a fraction of the cropped size.
MARGIN = 0.04
# Max-minus-min channel spread below which a pixel counts as neutral (grey/black/white) and is safe
# to invert. Above it the pixel carries a hue worth keeping.
NEUTRAL_SPREAD = 40
ALPHA_FLOOR = 10


def frames_rgba(img: Image.Image) -> list[Image.Image]:
    """Every frame as its own RGBA image (GIF frames are palette-based and share a canvas)."""
    return [frame.convert("RGBA") for frame in ImageSequence.Iterator(img)]


def content_box(frames: list[Image.Image]) -> tuple[int, int, int, int]:
    """Union of the frames' non-transparent bounding boxes, padded by MARGIN and clamped."""
    boxes = []
    for frame in frames:
        mask = frame.getchannel("A").point(lambda a: 255 if a > ALPHA_FLOOR else 0)
        box = mask.getbbox()
        if box:
            boxes.append(box)
    if not boxes:
        raise SystemExit(f"{SOURCE} has no visible pixels")
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    pad_x = int((right - left) * MARGIN)
    pad_y = int((bottom - top) * MARGIN)
    width, height = frames[0].size
    return (
        max(0, left - pad_x),
        max(0, top - pad_y),
        min(width, right + pad_x),
        min(height, bottom + pad_y),
    )


def invert_neutrals(frame: Image.Image) -> Image.Image:
    """Value-invert the neutral pixels, leave hued pixels and the alpha channel untouched."""
    r, g, b, a = frame.split()
    inverted = Image.merge(
        "RGBA",
        (r.point(lambda v: 255 - v), g.point(lambda v: 255 - v), b.point(lambda v: 255 - v), a),
    )
    # Neutral mask: channel spread = max - min, per pixel, via lighter/darker composites.
    hi = ImageChops.lighter(ImageChops.lighter(r, g), b)
    lo = ImageChops.darker(ImageChops.darker(r, g), b)
    neutral = ImageChops.subtract(hi, lo).point(lambda v: 255 if v <= NEUTRAL_SPREAD else 0)
    return Image.composite(inverted, frame, neutral)


def save(frames: list[Image.Image], path: Path, duration: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        path,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        quality=88,
        method=6,
        exact=True,  # do not let the encoder recolour fully transparent pixels
    )
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB  {len(frames)} frames {frames[0].size}")


def main() -> None:
    with Image.open(SOURCE) as img:
        duration = img.info.get("duration", 70)
        frames = frames_rgba(img)
    box = content_box(frames)
    scale = TARGET_WIDTH / (box[2] - box[0])
    size = (TARGET_WIDTH, max(1, round((box[3] - box[1]) * scale)))
    light = [f.crop(box).resize(size, Image.LANCZOS) for f in frames]
    save(light, OUT_LIGHT, duration)
    save([invert_neutrals(f) for f in light], OUT_DARK, duration)


if __name__ == "__main__":
    main()
