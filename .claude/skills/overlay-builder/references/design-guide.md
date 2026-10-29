# Stream overlay design guide

Rules of thumb for layouts that read well on a 1080p stream and survive real character data. Coordinates assume a 1920×1080 canvas; scale proportionally for others.

## Contents
- Scene types and where things go
- Safe area, grid and sizing
- Typography
- Colour
- Character cards
- Pages and carousels
- Motion
- Discord voice
- Checklist before handing over

## Scene types and where things go

| Scene | Background | Typical content | Starter recipe |
| --- | --- | --- | --- |
| Gameplay HUD (over the Foundry map) | **Transparent.** The map is the show; cover at most ~20% of the screen | Party cards along the bottom or a side column, a small title plate in a corner | `party-hud` |
| Character spotlight | Transparent | One large card cycling through characters and info pages | `spotlight-pages` |
| Starting soon / break / ending | Full-screen colour, gradient or image | Big title, subtitle, party portraits, socials footer | `starting-soon` |
| Webcam / guest frame | Transparent, with a hole where OBS puts the camera | Border-only frame, name plate | `camera-frame` |
| Dossier / side panel | Transparent or a full-height panel on one side | Shared identity block plus pages of stats, abilities, notes | `spotlight-pages`, extended |

Combine them: a gameplay HUD often has a camera frame too. Several overlays in one bundle are fine; the GM switches between them with **Active on stream**.

## Safe area, grid and sizing

- Keep important content at least **48 px** from the canvas edges. OBS crops and platform UI (chat overlays, progress bars) eat edges.
- Use an 8 px grid. Gaps between cards: 16–24 px. Panel padding: 12–20 px.
- Party bar: four 420×150 cards with 24 px gaps fit 1920 wide (x = 84, 528, 972, 1416; y = 882). Five or six cards: 340×130 each, or a vertical column on the left (x = 48, 300×120 each, gap 16).
- Widget instances must keep their design's proportions; a 420×150 design placed at 420×120 is stretched. Change the design's canvas instead.
- Cameras are 16:9: 480×270, 640×360 or 384×216.

## Typography

Minimum sizes at 1080p: names 28–40 px, values 20–24 px, captions 16–18 px. Anything under 14 px is unreadable after stream compression.

- Names: `autoFit: true` with `minFontSize` (16–18) so long names shrink instead of overflowing. Test with the longest plausible name (Cyrillic names run long).
- Captions: `uppercase: true`, `letterSpacing` 1–3, a muted colour. Values: bold, high contrast.
- Built-in families: Arial, Verdana, Georgia, Times New Roman, Courier New, Trebuchet MS. Any font configured in Foundry (**Configure Fonts**) also works by its plain family name, but the preview substitutes it unless it is installed on this PC.
- Mood: Georgia or Times New Roman for fantasy, gothic or horror; Trebuchet MS or Verdana for clean, modern or sci-fi; Courier New for terminals, dossiers and reports.
- Text on busy backgrounds needs a panel behind it or `highlightColor` (a background hugging the text itself).

## Colour

- One dominant dark panel colour, one accent, one muted text colour. Translucent panels use 8-digit hex: `#0b1020d9` is 85% opaque.
- Character accents: `accent: true` on names and bars uses each character's colour: the Character profiles accent, the colour rule from **Character colors**, or the system colour (CAIN blasphemy). Prefer this over hard-coding per-character colours, since it follows the character through every overlay.
- Keep text contrast at least 4.5:1. Avoid pure white panels; streams are watched in dark mode.
- Gradients: `gradientTo` with `gradientType: "linear"` and `gradientAngle`, or `"radial"` for a centre glow. A radial gradient on a small layer shows hard edges, so put a glow in a full-size background layer instead.
- Shapes: `clipShape` (circle, hexagon, diamond, chamfer, parallelogram…) cuts a layer, but clipping also cuts its border, shadow and voice glow. For round portraits that glow, use `circular: true` plus `cornerRadius` = half the size instead.

## Character cards

Anatomy: panel (colour layer, radius 12–18, 2 px translucent border, soft shadow) → portrait (`character-portrait`, `fit: cover`, `imagePosition: "top"` for busts) → name (`character-name`, accent, autoFit) → one or two bars (`resource-bar`, `showValue: true`) → a short stat line (`dynamic-text` with `{field}` tokens).

- Names: `character.callsign` shows the part of `Callsign (Real name)` before the parentheses, or the whole name; `character.realName` shows the part inside.
- Bars: `display: "dots"` suits small integer pools (stress 6, injuries 3, kit points); continuous bars suit HP. A bar's value text sits over both the fill and the empty track, so use light text with `shadow: true`, never a colour that matches either one.
- Unavailable values show `fallback`; `emptyText` replaces a blank result. Give every dynamic layer a sensible fallback (`"—"` or `" "`).

## Pages and carousels

When a card would need more than ~5 values, split them into pages instead of shrinking text.

- Identity (portrait, name, accent) goes in shared `layers`; changing information in `pages`.
- Dwell time is 5–8 s per page; `skipIfUnavailable: true` skips pages whose bound values are all missing.
- Several characters in one card: instance `actorUuids` lists every slot, with `carousel: { "enabled": true, "mode": "combined" }` and preset `cycling.mode` `"combined"`.
- Transitions: `fade-over`, the `wipe-*` transitions and `circle` keep repeated content steady; flips, `rotate`, `drop` and `glitch` play out, then in, so use them for character changes. Durations: 400–800 ms.

## Motion

Pick motion that matches the mood, and keep it short so it doesn't distract from the game.

| Mood | Entrances | Emphasis | Transitions | Easing |
| --- | --- | --- | --- | --- |
| Horror, CAIN, occult | `blur-in`, `glitch-in`, `fade-in` | `flicker`, `glitch`, `heartbeat` | `glitch`, `fade-over`, `blur` | `ease-out`, `steps` |
| Fantasy | `fade-in`, `shrink-in`, `drop-in` | `glow`, `pulse` | `fade-over`, `circle`, `flip-horizontal` | `ease-in-out`, `back-out` |
| Sci-fi, cyberpunk | `wipe-in-*`, `glitch-in`, `slide-in-*` | `glitch`, `flash`, `shake` | `wipe-*`, `glitch`, `zoom-in` | `expo-out`, `steps` |
| Cozy, light | `bounce-in`, `pop-in`, `slide-in-bottom` | `float`, `tada`, `rubber-band` | `zoom-out`, `drop` | `back-out` |

- Entrances 500–800 ms. Stagger a row of cards with per-instance `animationOverrides: true` and increasing `delay` (0, 120, 240…), as in `party-hud`.
- Value changes: preset `animations.transition` with `bar: true, numeric: true`, 300–500 ms.
- Reactions: triggers on bars. `decreased` → `color-flash` red; `increased` → green. A low-value warning is a `continuous: true` rule with a condition (for example `lt 25` on a percent field) playing `pulse` or `heartbeat`. Never use an unbounded repeat count.
- The full effect list and trigger grammar are in docs/OVERLAY_AUTHORING.md (Animation and carousel) and docs/EXTENDING.md.

## Discord voice

Layers can glow while a player speaks: `voiceTarget: "actor"` follows the player linked to that card's character in the world's **Discord players** window, so it works in reusable designs. `voiceShow: "always" | "present" | "speaking"` controls visibility, and `voiceEffect: "glow"` the highlight. Use `voiceTarget: "user"` with a Discord user ID only when the user gives one; don't put IDs into shared designs. The preview cannot simulate voice.

## Checklist before handing over

- [ ] Gameplay overlays leave the centre transparent.
- [ ] Nothing important closer than 48 px to an edge; nothing past the canvas unless intended.
- [ ] Longest plausible names and values fit (preview with `--samples`).
- [ ] Every dynamic layer has a fallback; fields exist for the target system or have mappings.
- [ ] Instances keep their design's proportions.
- [ ] Motion is short; nothing loops forever except continuous trigger rules.
