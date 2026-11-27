#!/usr/bin/env python3
"""
Generate bespoke high-craft Android adaptive/legacy launcher icons and PWA icons
for ChronoMap.

Design:
- Deep matte obsidian canvas (#0A0D14)
- Subtle concentric topographic contour rings
- Crisp glowing cyan-to-warm-amber curved GPS trajectory arc
- Precision waypoint pin at the trajectory apex
- Respects Android's 66% adaptive icon safe zone on ic_launcher_foreground.png
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageDraw, ImageFilter

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ANDROID_RES = PROJECT_ROOT / "android" / "app" / "src" / "main" / "res"
PUBLIC_ICONS = PROJECT_ROOT / "public" / "icons"

BG_HEX = (10, 13, 20)  # #0A0D14

MIPMAP_LAUNCHER_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

MIPMAP_FOREGROUND_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_rgb(c1: Tuple[int, int, int], c2: Tuple[int, int, int], t: float) -> Tuple[int, int, int]:
    return (
        int(round(lerp(c1[0], c2[0], t))),
        int(round(lerp(c1[1], c2[1], t))),
        int(round(lerp(c1[2], c2[2], t))),
    )


def sample_trajectory_color(t: float) -> Tuple[int, int, int]:
    """Smooth cyan -> electric sky -> warm amber -> solar gold progression."""
    stops = [
        (0.00, (34, 211, 238)),   # #22D3EE cyan
        (0.45, (56, 189, 248)),   # #38BDF8 sky
        (0.78, (245, 158, 11)),   # #F59E0B warm amber
        (1.00, (251, 191, 36)),   # #FBBF24 solar gold
    ]
    t = max(0.0, min(1.0, t))
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1:
            local = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            return lerp_rgb(c0, c1, local)
    return stops[-1][1]


def cubic_bezier(
    p0: Tuple[float, float],
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    p3: Tuple[float, float],
    t: float,
) -> Tuple[float, float]:
    u = 1.0 - t
    x = (
        (u**3) * p0[0]
        + 3 * (u**2) * t * p1[0]
        + 3 * u * (t**2) * p2[0]
        + (t**3) * p3[0]
    )
    y = (
        (u**3) * p0[1]
        + 3 * (u**2) * t * p1[1]
        + 3 * u * (t**2) * p2[1]
        + (t**3) * p3[1]
    )
    return (x, y)


def render_background(size: int) -> Image.Image:
    """Deep matte obsidian canvas with a very subtle radial cartographic depth gradient."""
    img = Image.new("RGBA", (size, size), BG_HEX + (255,))
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)

    cx, cy = size * 0.52, size * 0.44
    max_r = size * 0.62
    steps = 32
    for i in range(steps, 0, -1):
        frac = i / steps
        r = max_r * frac
        alpha = int(round(16 * (1.0 - frac) ** 1.7))
        draw.ellipse(
            (cx - r, cy - r, cx + r, cy + r),
            fill=(28, 42, 66, alpha),
        )

    img = Image.alpha_composite(img, glow)
    return img


def render_artwork(size: int, safe_scale: float = 0.62) -> Image.Image:
    """
    Render the ChronoMap emblem onto a transparent RGBA canvas of `size x size`.
    `safe_scale` controls how tightly the motif sits inside the canvas:
      - ~0.62 for Android adaptive ic_launcher_foreground.png (fits comfortably in 66% safe zone)
      - ~0.78 for standalone/legacy/PWA icons
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cx = size * 0.5
    cy = size * 0.5
    unit = size * safe_scale * 0.5  # Half-size of safe bounding box

    # 1. Subtle concentric topographic contour rings (organic harmonic modulation)
    topo_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    topo_draw = ImageDraw.Draw(topo_layer)

    ring_specs = [
        # (radius_mult, phase, amp1, amp2, alpha, width_mult)
        (0.46, 0.3, 0.06, 0.03, 46, 0.011),
        (0.70, 1.1, 0.08, 0.04, 38, 0.010),
        (0.95, 2.0, 0.09, 0.045, 30, 0.0095),
        (1.20, 0.7, 0.07, 0.035, 20, 0.009),
        (1.45, 1.8, 0.06, 0.03, 13, 0.0085),
    ]
    ring_center = (cx + unit * 0.14, cy - unit * 0.16)
    ring_segments = 180

    for rad_mult, phase, amp1, amp2, alpha, w_mult in ring_specs:
        pts = []
        base_r = unit * rad_mult
        for i in range(ring_segments + 1):
            theta = (2.0 * math.pi * i) / ring_segments
            wobble = (
                1.0
                + amp1 * math.sin(2.0 * theta + phase)
                + amp2 * math.cos(3.0 * theta - phase * 0.6)
            )
            r = base_r * wobble
            px = ring_center[0] + r * math.cos(theta)
            py = ring_center[1] + r * math.sin(theta) * 0.90
            pts.append((px, py))
        stroke_w = max(2, int(round(unit * w_mult)))
        topo_draw.line(pts, fill=(148, 178, 214, alpha), width=stroke_w, joint="curve")

    # Subtle instrument crosshairs at safe-zone cardinal ticks
    tick_len = unit * 0.10
    tick_r = unit * 1.02
    tick_w = max(2, int(round(unit * 0.012)))
    tick_col = (148, 163, 184, 52)
    for angle_deg in (0, 90, 180, 270):
        rad = math.radians(angle_deg)
        x0 = cx + (tick_r - tick_len) * math.cos(rad)
        y0 = cy + (tick_r - tick_len) * math.sin(rad)
        x1 = cx + tick_r * math.cos(rad)
        y1 = cy + tick_r * math.sin(rad)
        topo_draw.line([(x0, y0), (x1, y1)], fill=tick_col, width=tick_w)

    canvas = Image.alpha_composite(canvas, topo_layer)

    # 2. Curved GPS Trajectory Arc (Cubic Bezier from lower-left to upper-right apex)
    p0 = (cx - unit * 0.70, cy + unit * 0.56)
    p1 = (cx - unit * 0.56, cy - unit * 0.30)
    p2 = (cx + unit * 0.12, cy + unit * 0.44)
    p3 = (cx + unit * 0.44, cy - unit * 0.34)

    num_samples = 360
    curve_pts = [
        cubic_bezier(p0, p1, p2, p3, i / num_samples)
        for i in range(num_samples + 1)
    ]

    # Soft multi-pass glow behind the trajectory
    glow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)
    glow_r = unit * 0.095
    for i in range(0, num_samples + 1, 2):
        t = i / num_samples
        x, y = curve_pts[i]
        rgb = sample_trajectory_color(t)
        r = glow_r * (0.72 + 0.35 * t)
        glow_draw.ellipse(
            (x - r, y - r, x + r, y + r),
            fill=rgb + (135,),
        )
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=max(2, unit * 0.14)))
    canvas = Image.alpha_composite(canvas, glow_layer)

    # Crisp main trajectory stroke (variable subtle taper into apex)
    route_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    route_draw = ImageDraw.Draw(route_layer)
    core_r = unit * 0.068
    for i in range(num_samples + 1):
        t = i / num_samples
        x, y = curve_pts[i]
        rgb = sample_trajectory_color(t)
        r = core_r * (0.74 + 0.32 * t)
        route_draw.ellipse((x - r, y - r, x + r, y + r), fill=rgb + (255,))

    # Inner luminous specular filament composited cleanly on its own layer
    filament_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    filament_draw = ImageDraw.Draw(filament_layer)
    filament_r = core_r * 0.25
    for i in range(num_samples + 1):
        t = i / num_samples
        x, y = curve_pts[i]
        filament_draw.ellipse(
            (x - filament_r, y - filament_r, x + filament_r, y + filament_r),
            fill=(255, 255, 255, int(round(65 + 75 * t))),
        )
    route_layer = Image.alpha_composite(route_layer, filament_layer)
    route_draw = ImageDraw.Draw(route_layer)

    # Start waypoint anchor (precision cyan origin node)
    sx, sy = p0
    start_outer = unit * 0.11
    start_inner = unit * 0.055
    route_draw.ellipse(
        (sx - start_outer, sy - start_outer, sx + start_outer, sy + start_outer),
        fill=(10, 13, 20, 255),
        outline=(34, 211, 238, 240),
        width=max(2, int(round(unit * 0.032))),
    )
    route_draw.ellipse(
        (sx - start_inner, sy - start_inner, sx + start_inner, sy + start_inner),
        fill=(165, 243, 252, 255),
    )

    canvas = Image.alpha_composite(canvas, route_layer)

    # 3. Precision Waypoint Pin at the Apex
    ax, ay = p3
    pin_glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pin_glow_draw = ImageDraw.Draw(pin_glow)
    r_aura = unit * 0.34
    pin_glow_draw.ellipse(
        (ax - r_aura, ay - r_aura, ax + r_aura, ay + r_aura),
        fill=(251, 191, 36, 125),
    )
    pin_glow = pin_glow.filter(ImageFilter.GaussianBlur(radius=max(2, unit * 0.16)))
    canvas = Image.alpha_composite(canvas, pin_glow)

    pin_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pin_draw = ImageDraw.Draw(pin_layer)

    # Translucent radar halo ring around pin
    r_halo = unit * 0.30
    pin_draw.ellipse(
        (ax - r_halo, ay - r_halo, ax + r_halo, ay + r_halo),
        fill=(245, 158, 11, 34),
        outline=(251, 191, 36, 150),
        width=max(2, int(round(unit * 0.022))),
    )

    # Precision pin teardrop anchored cleanly with geometric tangency at (ax, ay)
    head_r = unit * 0.205
    head_cy = ay - unit * 0.295
    tip_y = ay + unit * 0.015

    def teardrop_polygon(cx_p: float, cy_p: float, r_p: float, tip_p: float) -> list[Tuple[float, float]]:
        dist = max(r_p * 1.05, tip_p - cy_p)
        # Tangent angle from tip to circle
        sin_a = min(0.98, r_p / dist)
        cos_a = math.sqrt(max(0.0, 1.0 - sin_a * sin_a))
        tx = r_p * cos_a
        ty = r_p * sin_a
        return [
            (cx_p - tx, cy_p + ty),
            (cx_p + tx, cy_p + ty),
            (cx_p, tip_p),
        ]

    # Dark obsidian outline collar for contrast
    collar_pad = unit * 0.04
    pin_draw.polygon(
        teardrop_polygon(ax, head_cy, head_r + collar_pad, tip_y + collar_pad * 1.25),
        fill=(10, 13, 20, 250),
    )
    pin_draw.ellipse(
        (
            ax - head_r - collar_pad,
            head_cy - head_r - collar_pad,
            ax + head_r + collar_pad,
            head_cy + head_r + collar_pad,
        ),
        fill=(10, 13, 20, 250),
    )

    # Warm amber-gold pin body (unified silhouette)
    pin_draw.polygon(
        teardrop_polygon(ax, head_cy, head_r, tip_y),
        fill=(251, 191, 36, 255),
    )
    pin_draw.ellipse(
        (ax - head_r, head_cy - head_r, ax + head_r, head_cy + head_r),
        fill=(251, 191, 36, 255),
    )

    # Precision obsidian bezel + luminous white core dot inside pin head
    bezel_r = head_r * 0.50
    core_dot_r = head_r * 0.34
    pin_draw.ellipse(
        (ax - bezel_r, head_cy - bezel_r, ax + bezel_r, head_cy + bezel_r),
        fill=(10, 13, 20, 255),
    )
    pin_draw.ellipse(
        (ax - core_dot_r, head_cy - core_dot_r, ax + core_dot_r, head_cy + core_dot_r),
        fill=(255, 255, 255, 255),
    )

    canvas = Image.alpha_composite(canvas, pin_layer)
    return canvas


def apply_circle_mask(img: Image.Image) -> Image.Image:
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    pad = max(1, int(round(size * 0.02)))
    draw.ellipse((pad, pad, size - pad, size - pad), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def apply_rounded_rect_mask(img: Image.Image, radius_ratio: float = 0.22) -> Image.Image:
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    pad = max(1, int(round(size * 0.02)))
    radius = int(round(size * radius_ratio))
    draw.rounded_rectangle((pad, pad, size - pad, size - pad), radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def save_resized(master: Image.Image, target_size: int, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    resized = master.resize((target_size, target_size), Image.Resampling.LANCZOS)
    resized.save(dest, format="PNG", optimize=True)


def main() -> None:
    master_size = 1024

    # Master 1: Adaptive foreground (transparent bg, 66% safe zone)
    adaptive_fg = render_artwork(master_size, safe_scale=0.60)

    # Master 2: Full-bleed square icon (for PWA maskable & base for legacy icons)
    bg_master = render_background(master_size)
    full_art = render_artwork(master_size, safe_scale=0.76)
    full_square = Image.alpha_composite(bg_master, full_art)

    # Master 3: Legacy rounded-square & round launcher masters
    legacy_square = apply_rounded_rect_mask(full_square, radius_ratio=0.22)
    legacy_round = apply_circle_mask(full_square)

    generated = []

    # Android Adaptive Foregrounds
    for folder, px in MIPMAP_FOREGROUND_SIZES.items():
        dest = ANDROID_RES / folder / "ic_launcher_foreground.png"
        save_resized(adaptive_fg, px, dest)
        generated.append(dest)

    # Android Legacy & Round Launchers
    for folder, px in MIPMAP_LAUNCHER_SIZES.items():
        dest_sq = ANDROID_RES / folder / "ic_launcher.png"
        dest_rd = ANDROID_RES / folder / "ic_launcher_round.png"
        save_resized(legacy_square, px, dest_sq)
        save_resized(legacy_round, px, dest_rd)
        generated.extend([dest_sq, dest_rd])

    # PWA Icons (full-bleed matte obsidian so maskable & any both render cleanly)
    for px, name in ((192, "icon-192.png"), (512, "icon-512.png")):
        dest = PUBLIC_ICONS / name
        save_resized(full_square, px, dest)
        generated.append(dest)

    print(f"Generated {len(generated)} ChronoMap icon assets successfully.")


if __name__ == "__main__":
    main()
