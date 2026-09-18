#!/usr/bin/env python3
"""
Draws local-ai-app-builder's favicon from scratch — an original mark, not
based on any existing product's logo.

Design: a rounded-square "squircle" in the app's own near-black panel color,
containing a terminal prompt chevron (">") and a trailing cursor block — a
direct reference to what this app actually is (a chat-prompt-driven code
builder), rendered in white with a soft glow filter matching the app's own
CSS glow tokens (see src/index.css's `.glow` / `.glow-lg`).

The chevron's three vertices are computed from angle + arm-length (real
geometry, not a hand-copied path string) so the shape is easy to re-tune —
change ARM_ANGLE_DEG or ARM_LENGTH and re-run.

Usage:
    python3 scripts/generate_favicon.py

Writes:
    scripts/favicon.svg        (the freshly drawn file — the "download")
    public/favicon.svg         (copied over so the app actually uses it)
"""

import math
from pathlib import Path

# ── Tunable design parameters ────────────────────────────────────────────
SIZE = 128                     # SVG viewBox is SIZE x SIZE
CORNER_RADIUS = 28              # squircle corner rounding
BG_COLOR = "#0d0d0d"            # matches --color-panel in src/index.css
MARK_COLOR = "#f5f5f5"          # near-white, matches --color-text
STROKE_WIDTH = 11

CENTER_X = SIZE / 2 - 4          # nudged slightly left to balance the cursor block
CENTER_Y = SIZE / 2
ARM_LENGTH = 26                  # length of each chevron arm
ARM_ANGLE_DEG = 34               # half-angle of the chevron's opening

CURSOR_WIDTH = 14
CURSOR_HEIGHT = 34
CURSOR_GAP = 14                  # space between the chevron's tip and the cursor block


def chevron_points(cx: float, cy: float, arm_length: float, angle_deg: float) -> str:
    """Computes the three vertices of a right-pointing chevron (">") — top
    arm, tip, bottom arm — from a center point, an arm length, and the
    half-angle of the opening. Returns an SVG `points` attribute string."""
    angle = math.radians(angle_deg)
    tip_x = cx + arm_length * math.cos(0)
    tip_y = cy

    top_x = cx - arm_length * math.cos(angle) * 0.15
    top_y = cy - arm_length * math.sin(angle)

    bottom_x = top_x
    bottom_y = cy + arm_length * math.sin(angle)

    return f"{top_x:.2f},{top_y:.2f} {tip_x:.2f},{tip_y:.2f} {bottom_x:.2f},{bottom_y:.2f}"


def build_svg() -> str:
    points = chevron_points(CENTER_X - 6, CENTER_Y, ARM_LENGTH, ARM_ANGLE_DEG)

    cursor_x = CENTER_X - 6 + ARM_LENGTH * math.cos(0) - 4 + CURSOR_GAP
    cursor_y = CENTER_Y - CURSOR_HEIGHT / 2

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">
  <defs>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3.2" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <rect x="0" y="0" width="{SIZE}" height="{SIZE}" rx="{CORNER_RADIUS}" fill="{BG_COLOR}" />

  <g filter="url(#glow)" fill="none" stroke="{MARK_COLOR}"
     stroke-width="{STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="{points}" />
    <line x1="{cursor_x:.2f}" y1="{cursor_y:.2f}"
          x2="{cursor_x:.2f}" y2="{cursor_y + CURSOR_HEIGHT:.2f}" />
  </g>
</svg>
"""


def main() -> None:
    svg = build_svg()

    script_dir = Path(__file__).resolve().parent
    local_copy = script_dir / "favicon.svg"
    local_copy.write_text(svg, encoding="utf-8")
    print(f"Drew and saved: {local_copy}")

    project_root = script_dir.parent
    public_target = project_root / "public" / "favicon.svg"
    public_target.write_text(svg, encoding="utf-8")
    print(f"Installed as favicon: {public_target}")


if __name__ == "__main__":
    main()
