#!/usr/bin/env python3
"""
Pixel Arena Idle - asset pipeline.

Takes the raw AI-sourced key art in game/assets/raw + game/assets/art and turns it
into compact, web/APK-ready sprites:

  * chroma-keys the flat magenta background out of character/enemy art
  * trims to the sprite's alpha bounds (so layout math is predictable)
  * area-averages down to game resolution, then light-unsharpens so the pixel
    art reads crisply on high-DPI phones
  * emits PNG + WebP (WebP is what the app actually loads; PNG is a fallback and
    keeps the repo readable)

Run:  python3 tools/build_assets.py
Deps: pillow, numpy
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "game" / "assets"
RAW = ASSETS / "raw"
ART = ASSETS / "art"
OUT_SPR = ASSETS / "sprites"
OUT_UI = ASSETS / "ui"
SCENE = ASSETS / "scene"
STORE = ROOT / "store"

# name -> (source, output height in px, has alpha)
SPRITES = {
    "rowan": ("hero_rowan.png", 128),
    "luna": ("hero_luna.png", 128),
    "nixie": ("hero_nixie.png", 128),
    "fox": ("hero_fox.png", 112),
    "slime": ("enemy_slime.png", 104),
    "boss": ("enemy_boss.png", 176),
    "mimic": ("enemy_mimic.png", 116),
}

# App-icon densities required by the Android mipmap folders.
ICON_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def open_any(path: Path) -> Image.Image:
    """Load a source image: PNG or JPEG (JPEG keeps the repo small)."""
    for candidate in (path, path.with_suffix(".jpg")):
        if candidate.exists():
            with Image.open(candidate) as im:
                return im.convert("RGB")
    raise FileNotFoundError(path)


def load_rgb(path: Path) -> np.ndarray:
    return np.asarray(open_any(path), dtype=np.float32)





def sample_key(rgb: np.ndarray) -> np.ndarray:
    """Median colour of the image border = the flat backdrop the generator used."""
    border = np.concatenate(
        [
            rgb[:8].reshape(-1, 3),
            rgb[-8:].reshape(-1, 3),
            rgb[:, :8].reshape(-1, 3),
            rgb[:, -8:].reshape(-1, 3),
        ]
    )
    return np.median(border, axis=0)


def key_magenta(rgb: np.ndarray) -> Image.Image:
    """Remove the flat magenta backdrop, with soft edges and no magenta fringe.

    Magenta is (high R, ~0 G, high B), so the green channel is the reliable
    discriminator: real art (skin, cloth, outlines) always sits well above the
    backdrop's green level. The key is *sampled per image* because generators
    drift the backdrop's brightness between files.

    Two extra safeguards keep the cut-out clean:
      * only background connected to the image border is cleared, so pink
        costume details enclosed by the silhouette are never punched out;
      * near-edge pixels get fractional alpha and are un-mixed against the key
        colour, which removes the pink glow the generator leaves on outlines.
    """
    key = sample_key(rgb)
    g = rgb[..., 1]
    g_key = float(key[1])

    # Everything clearly greener than the backdrop is definitely foreground.
    strong = g > g_key + 26
    bg_ish = (g < g_key + 20) & (rgb[..., 0] > 90) & (rgb[..., 2] > 90)

    # Keep only the backdrop region that is connected to the canvas border.
    labels, n = ndimage.label(bg_ish)
    bg = np.zeros(g.shape, dtype=bool)
    if n:
        border_labels = np.unique(
            np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
        )
        border_labels = border_labels[border_labels != 0]
        bg = np.isin(labels, border_labels)

        # Gaps fully enclosed by the silhouette (e.g. between an arm and a
        # torso) never touch the border. Accept an enclosed pocket as backdrop
        # when it is plainly the key colour -- real costume pinks are warmer and
        # dimmer than the near-white-magenta backdrop.
        sizes = np.bincount(labels.ravel())
        flat = labels.ravel()
        sum_r = np.bincount(flat, weights=rgb[..., 0].ravel(), minlength=labels.max() + 1)
        sum_g = np.bincount(flat, weights=rgb[..., 1].ravel(), minlength=labels.max() + 1)
        sum_b = np.bincount(flat, weights=rgb[..., 2].ravel(), minlength=labels.max() + 1)
        counts = np.maximum(sizes, 1)
        mean_r, mean_g, mean_b = sum_r / counts, sum_g / counts, sum_b / counts
        enclosed_bg = np.zeros(len(sizes), dtype=bool)
        for lab in range(1, len(sizes)):
            if lab in border_labels or sizes[lab] < 120:
                continue
            if mean_r[lab] > 195 and mean_b[lab] > 190 and mean_g[lab] < g_key + 18:
                enclosed_bg[lab] = True
        if enclosed_bg.any():
            bg |= np.isin(labels, np.flatnonzero(enclosed_bg))

    alpha = np.ones(g.shape, dtype=np.float32)
    ramp = np.clip((g - (g_key + 6.0)) / 16.0, 0.0, 1.0)
    alpha[bg] = ramp[bg]
    alpha[strong] = 1.0
    # Solid interior of the backdrop: fully transparent, no lingering haze.
    alpha[bg & (g < g_key + 6)] = 0.0

    # Halo suppression. Generators leave low-amplitude colour noise all over
    # the backdrop; if that noise kept fractional alpha the sprite would sit in
    # a faint visible rectangle. Only the thin band hugging the silhouette is
    # allowed to stay semi-transparent.
    near_fg = ndimage.binary_dilation(strong, iterations=3)
    alpha[bg & ~near_fg] = 0.0

    # Fringe clean-up. Un-mixing in sRGB space amplifies noise into a magenta
    # halo, so instead we knock the magenta dominance out of the edge pixels:
    # clamp R and B to a small multiple of G. Dark outlines (G~0) stay dark, and
    # genuine costume pinks are only touched where the green channel is already
    # tiny -- i.e. right on the silhouette.
    edge = bg & (alpha > 0.02)
    fixed = rgb.copy()
    if edge.any():
        e = rgb[edge]
        cap = e[:, 1:2] * 1.35
        fixed[edge] = np.stack(
            [np.minimum(e[:, 0], cap[:, 0]), e[:, 1], np.minimum(e[:, 2], cap[:, 0])],
            axis=1,
        )

    rgba = np.dstack([np.clip(fixed, 0, 255), alpha * 255.0]).astype(np.uint8)
    # Pixels that are fully transparent keep whatever colour the generator put
    # there (magenta). Browsers bilinearly interpolate RGB even at alpha 0, so
    # neutralise the hidden colour to stop magenta bleeding on scaled sprites.
    rgba[..., :3][alpha <= 0.02] = (24, 20, 16)
    return Image.fromarray(rgba, "RGBA")


def trim(img: Image.Image, pad_ratio: float = 0.02) -> Image.Image:
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        return img
    img = img.crop(bbox)
    pad = max(1, int(round(max(img.size) * pad_ratio)))
    out = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    out.paste(img, (pad, pad))
    return out


def resize_pixel(img: Image.Image, height: int) -> Image.Image:
    """Area-average down, then crisp up. Keeps pixel art legible when scaled."""
    scale = height / img.height
    size = (max(1, round(img.width * scale)), height)
    small = img.resize(size, Image.LANCZOS)
    # Mild sharpen restores the edge contrast that Lanczos softens.
    rgb = small.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.2, percent=90, threshold=2))
    a = small.getchannel("A").filter(ImageFilter.UnsharpMask(radius=1.0, percent=60, threshold=0))
    out = rgb.convert("RGBA")
    out.putalpha(a)
    return out


def save_both(img: Image.Image, out_dir: Path, name: str, webp_quality: int = 88) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    img.save(out_dir / f"{name}.png", optimize=True)
    img.save(out_dir / f"{name}.webp", quality=webp_quality, method=6)


def build_sprites(index: dict) -> None:
    OUT_SPR.mkdir(parents=True, exist_ok=True)
    for name, (src, height) in SPRITES.items():
        path = RAW / src
        if not path.exists():
            # The raw art is stored as JPEG to keep the repo light.
            path = path.with_suffix(".jpg")
        if not path.exists():
            print(f"  ! missing {path}")
            continue
        keyed = key_magenta(load_rgb(path))
        cut = trim(keyed)
        final = resize_pixel(cut, height)
        save_both(final, OUT_SPR, name)
        index["sprites"][name] = {
            "w": final.width,
            "h": final.height,
            "src": f"assets/sprites/{name}.webp",
        }
        print(f"  sprite {name:6s} {final.width:3d}x{final.height:3d}")


def build_backgrounds(index: dict) -> None:
    """Key art doubles as the title/menu panorama, pre-sized for phones."""
    OUT_UI.mkdir(parents=True, exist_ok=True)
    SCENE.mkdir(parents=True, exist_ok=True)
    key = open_any(ART / "keyart")
    # Portrait-safe crop: keep the middle of the scene.
    for name, size in (("title_land", (1600, 900)), ("title_port", (900, 1600))):
        if size[0] > size[1]:
            if key.width / key.height < size[0] / size[1]:
                scale = size[0] / key.width
            else:
                scale = size[1] / key.height
        else:
            scale = size[1] / key.height
        w, h = round(key.width * scale), round(key.height * scale)
        big = key.resize((w, h), Image.LANCZOS)
        # Cover-crop.
        left = (w - size[0]) // 2
        top = (h - size[1]) // 2
        crop = big.crop((left, top, left + size[0], top + size[1]))
        crop = crop.filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))
        # Scenes are large; ship WebP only (all targets read it).
        crop.save(SCENE / f"{name}.webp", quality=84, method=6)
        index["ui"][name] = {"w": crop.width, "h": crop.height, "src": f"assets/scene/{name}.webp"}
        print(f"  bg     {name:11s} {crop.width}x{crop.height}")


ANDROID_RES = ROOT / "game" / "android" / "res"
ANDROID_TEMPLATE = ROOT / "android-template"


def build_icons() -> None:
    icon = open_any(ART / "icon")
    OUT_UI.mkdir(parents=True, exist_ok=True)
    save_both(icon.resize((512, 512), Image.LANCZOS), OUT_UI, "icon", 92)
    android = ANDROID_RES
    for folder, px in ICON_DENSITIES.items():
        d = android / folder
        d.mkdir(parents=True, exist_ok=True)
        square = icon.resize((px, px), Image.LANCZOS)
        square.save(d / "ic_launcher.png", optimize=True)
        # round icon: circular alpha mask, as the launcher expects
        mask = Image.new("L", (px * 4, px * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
        mask = mask.resize((px, px), Image.LANCZOS)
        round_icon = square.convert("RGBA")
        round_icon.putalpha(mask)
        round_icon.save(d / "ic_launcher_round.png", optimize=True)
    print(f"  icons  {len(ICON_DENSITIES)} mipmap densities + 512 web icon")

    # Portrait/landscape splash + a wide feature graphic for the store listing.
    # Store-listing art is not part of the playable bundle.
    STORE.mkdir(parents=True, exist_ok=True)
    feature = open_any(ART / "keyart")
    fw = 1024
    feature.resize((fw, round(feature.height * fw / feature.width)), Image.LANCZOS).save(
        STORE / "feature_graphic.png", optimize=True
    )


def build_splash() -> None:
    """Splash art for the Android launch theme.

    Android resolves @drawable/splash against density-specific folders, so we
    emit a base copy (all densities) plus a landscape override. The launcher
    theme picks these up before the WebView is ready.
    """
    key = open_any(ART / "keyart")

    def crop_to(size):
        ar = size[0] / size[1]
        kar = key.width / key.height
        if kar > ar:
            w = round(key.height * ar)
            box = ((key.width - w) // 2, 0, (key.width - w) // 2 + w, key.height)
        else:
            h = round(key.width / ar)
            box = (0, (key.height - h) // 2, key.width, (key.height - h) // 2 + h)
        return key.crop(box).resize(size, Image.LANCZOS)

    for folder, size in (
        ("drawable", (1080, 1920)),
        ("drawable-land", (1920, 1080)),
    ):
        d = ANDROID_RES / folder
        d.mkdir(parents=True, exist_ok=True)
        crop_to(size).save(d / "splash.png", optimize=True)
    print("  splash drawable + drawable-land")


def main() -> None:
    for p in (OUT_SPR, OUT_UI):
        p.mkdir(parents=True, exist_ok=True)
    index: dict = {"sprites": {}, "ui": {}, "atlasVersion": 1}
    print("building sprites...")
    build_sprites(index)
    print("building backgrounds...")
    build_backgrounds(index)
    print("building icons...")
    build_icons()
    build_splash()
    meta = ASSETS / "atlas.json"
    meta.write_text(json.dumps(index, indent=2) + "\n")
    write_android_overlay(index)
    total = sum(f.stat().st_size for f in ASSETS.rglob("*") if f.is_file())
    print(f"atlas.json written; assets/ total {total/1024/1024:.2f} MB")


def write_android_overlay(index: dict) -> None:
    """Emit the files the web build copies into the Capacitor Android shell."""
    (ANDROID_RES / "values").mkdir(parents=True, exist_ok=True)
    (ANDROID_RES / "values" / "colors.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <color name="brand_bg">#201812</color>\n'
        '    <color name="brand_gold">#FFC531</color>\n'
        '    <color name="brand_leaf">#5FBF3F</color>\n'
        "</resources>\n"
    )
    (ANDROID_RES / "values" / "strings.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <string name="app_name">Pixel Arena Idle</string>\n'
        '    <string name="title_activity_main">Pixel Arena Idle</string>\n'
        '    <string name="package_name">com.pixelarena.idle</string>\n'
        '    <string name="custom_url_scheme">com.pixelarena.idle</string>\n'
        "</resources>\n"
    )
    print("  android overlay written to game/android/res")


if __name__ == "__main__":
    main()
