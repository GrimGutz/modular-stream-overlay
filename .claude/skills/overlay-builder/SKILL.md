---
name: overlay-builder
description: Builds new stream overlays and character widget designs for the Modular Stream Overlay Foundry VTT module from a free-form description, for any game system (CAIN, D&D 5e, PF2e, Cyberpunk RED, or any other through field mappings) — gameplay HUDs, party bars, character cards and dossiers, "starting soon"/break/ending screens, webcam frames. Produces a validated bundle, a GM install macro and PNG previews. Use whenever the user asks to create, design, mock up, recreate, restyle or extend an overlay, OBS scene, HUD or widget for this module, in any language («сделай оверлей», «новый виджет персонажа», «экран перерыва», «оформление для стрима»), even when they only describe the look, paste a screenshot or name a mood.
---

# Overlay builder

Turn a description into a ready-to-install overlay for this module: an authoring source, a validated bundle, a GM Script Macro that opens the module's import dialog, and screenshots rendered by the module's real renderer. The GM installs it in Foundry with an explicit **Install**; this skill never touches the world.

Work from the module root (the folder with `module.json`, id `modular-stream-overlay`). All output goes under `work/`, which git ignores. Reply in the user's language.

## Ground rules

These keep the user's world and the module safe, and keep layouts loadable:

- Use only real schema fields. `tools/overlay-author.mjs` rejects unknown keys; docs/OVERLAY_AUTHORING.md is the field reference. There's no custom CSS, HTML or script, so a look the schema can't express gets the closest supported approximation, and you say so.
- Don't edit module code, `storage/`, `assets/`, world data or other modules to make a layout work. If the design truly needs a missing feature, say so instead.
- Never install, activate or overwrite records. Generation is local; the GM runs the macro and confirms. Pick fresh IDs (see step 4) so nothing collides.
- Characters go on overlay instances as `$actor:slot` placeholders; designs stay reusable. Use real Actor UUIDs or Discord IDs only when the user gives them.
- Images: reference existing files by their Foundry path (`modules/...`, `worlds/<world>/...`, or a user folder in Foundry's Data). If the user hands you a new image file, ask before copying anything into Foundry's Data folder. Never embed data URIs or remote static-image URLs.

## Workflow

### 1. Read the brief

Pull out the following, and fill gaps with the defaults:

| Aspect | Default |
| --- | --- |
| Scene type (HUD, spotlight, break screen, camera frame, dossier) | Gameplay HUD |
| Canvas | 1920×1080 |
| Game system and what data to show | Ask if live data is wanted and the system is unclear |
| Characters: how many, one card each or one cycling card | 4, one card each |
| Pages per character, cycling, transitions | None for small cards |
| Style: palette, fonts, mood, reference images | Dark translucent panels, one accent, character accents |
| Motion | Short entrance, smooth bar changes, damage/heal flashes |
| Discord voice glow | Portraits glow via `voiceTarget: "actor"` |

Ask one short round of questions only for real blockers: the game system when the overlay should show stats, or images they expect you to use. Otherwise state your assumptions in the final summary and proceed. If they give a screenshot or mock-up, measure positions in proportion to the canvas.

### 2. Choose the data

Run `node .claude/skills/overlay-builder/scripts/fields.mjs --system <cain|dnd5e|pf2e|cyberpunk-red-core|any>` and pick fields from it. For a system without an adapter, follow references/fields-and-systems.md: find real `system.*` paths, write GM field mappings, bind their `character.*` IDs. Never bind a `system.*` path directly.

### 3. Design

Read references/design-guide.md before laying anything out: safe area, sizes, typography, colour, motion by mood and voice. The main points:
- Gameplay overlays keep the centre transparent.
- Text is at least 16 px, names `autoFit`.
- Use `accent: true` for per-character colour.
- Split long content into pages instead of shrinking it.

### 4. Start the source from the closest recipe

Four starters in `assets/recipes/` validate and render cleanly:

| Recipe | What it is |
| --- | --- |
| `party-hud` | Transparent HUD: title plate, four staggered party cards (portrait with voice glow, accent name, HP bar with damage and heal flashes) |
| `spotlight-pages` | One large card cycling every character through Vitals, Identity and Art pages (wipe and flip transitions) |
| `starting-soon` | Full-screen gradient scene: title, subtitle, four portrait cards, footer |
| `camera-frame` | Border-only webcam frame with a name plate |

```bash
node .claude/skills/overlay-builder/scripts/new-source.mjs party-hud dnd-party --out work/authoring/dnd-party.json --title "D&D Party"
```

The prefix becomes the start of every record ID, so make it specific to this overlay (`cpr-neon-hud`, `cain-break-ru`). Then edit the source:
- Restyle it, swap bindings to the chosen fields, and add or remove layers, pages and instances.
- Combine recipes by merging their `widgetPresets`, `overlays` and `actors`.
- For anything unusual, write the source from scratch using the format in docs/OVERLAY_AUTHORING.md.

Keep each record's `id` unique across the bundle and every component ID unique within its design.

### 5. Generate and validate

```bash
node tools/overlay-author.mjs generate work/authoring/<slug>.json --out work/generated/<slug>.json --macro work/generated/<slug>.macro.js --force
node tools/overlay-author.mjs validate work/generated/<slug>.json
```

`--force` only replaces your own local output files. An `Unsupported field: path.key` error means that key doesn't exist there; check the field tables in docs/OVERLAY_AUTHORING.md rather than guessing a new name. Add `--actor slot=Actor.ID` only when the user supplied UUIDs.

### 6. Preview, look, fix

```bash
node .claude/skills/overlay-builder/scripts/preview.mjs work/generated/<slug>.json --pages
```

This renders every overlay, and every carousel page with `--pages`, in headless Chrome or Edge with generated sample characters. It writes PNGs and `preview-report.json` next to the bundle, and prints three kinds of problems:
- **Runtime:** errors, overflowing text, images that failed to load.
- **Checks:** unknown fields, layers past the canvas, stretched instances, fonts the preview lacks.

Then:
- **Open the PNGs and look at them.** A clean report doesn't mean the design works; judge alignment, spacing, contrast and hierarchy against the brief.
- **Test the worst case.** Rerun with `--samples samples.json` holding the longest realistic names and values, in the user's language. The format is `{"*": {"character.name": "…"}, "p2": {"character.hp.current": 0}}`.
- **Fix and regenerate** until both the report and your eye are satisfied, usually two or three passes.
- **Watch the motion when it matters:** `--serve` prints local URLs that play animations and carousels live, for a browser.

### 7. Hand over

Tell the user, in their language:
- **What was built:** overlays and designs by name, canvas, Actor slots, and which fields each shows. Include assumptions you made.
- **Files:** source, bundle, macro, preview PNGs, and the mappings file if any. Send the main preview image if a file-sending tool is available.
- **Install:**
  1. In Foundry, as GM: Macros → create a **Script** macro, paste the contents of `<slug>.macro.js`, run it.
  2. Pick a character for each slot and press **Install**.
  3. Open the overlay in the editor, check it, then choose it in **Active on stream**.
  4. If there are mappings, add them first (references/fields-and-systems.md).
  5. The OBS viewer account needs Observer access to those characters.
- **Updating later:** rerunning a newer macro offers **Update**. It replaces the designs and keeps already-installed overlays as they are, so layout changes to an installed overlay need a new overlay ID or edits in the editor.
- **What was verified:** generated, validated, and rendered with sample data in headless Chromium.
- **What was not verified:** a real Foundry world, real characters, Foundry-only fonts, Discord voice and OBS. Never claim those were tested unless you actually ran them.

## Files

- `scripts/fields.mjs`: lists bindable fields per system from the module's own adapters.
- `scripts/new-source.mjs`: copies a recipe with fresh IDs.
- `scripts/preview.mjs`: renders a bundle to PNGs plus a problem report (Node 22+, Chrome/Edge/Chromium; no npm packages).
- `references/design-guide.md`: layout, typography, colour and motion guidance, with a pre-handover checklist.
- `references/fields-and-systems.md`: data sources, field mappings for any system, accents and Actor slots.
- `assets/recipes/*.json`: the four validated starters.
- Module docs: docs/OVERLAY_AUTHORING.md (complete source format), docs/EXTENDING.md (animations and triggers), docs/CAIN.md, docs/DND5E.md, docs/PF2E.md, docs/CYBERPUNK_RED.md.
