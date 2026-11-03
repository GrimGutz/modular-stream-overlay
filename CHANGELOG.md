# Changelog

## Unreleased

- **PF2e adapter** (8.6.x, Foundry 14): 34 fields for characters and NPCs — HP, AC, level, perception, saves, attribute modifiers, dying/wounded/doomed, active conditions, hero and focus points, shield, experience, class, ancestry and heritage. Character colors suggest a color per class.
- **Cyberpunk RED adapter** (0.92.x): 29 fields for characters and mooks — HP, wound state, death save, humanity, the ten stats, armor SP, role, reputation and eurobucks. Character colors suggest a color per role. Cyberpunk RED has no Foundry 14 release yet, so it can run once that release is checked and added.
- Health, AC, level and attribute modifier fields share their IDs across D&D5e, PF2e and Cyberpunk RED, so one design reads several systems.
- **Player streams:** a player can run the stream instead of the GM. The GM only checks **May stream** for them. The player then opens the overlay editor from their Settings sidebar with their own studio, saved under their account: overlays, widget designs, fragments, imports, the overlay on stream, live controls and Discord players. Their OBS connector signs in with their own account. Their stream shows characters with their own account's access, and the GM sees which ones it can't observe.
- The overlay-builder Claude Code skill builds overlays from a description (source repository only).

## 0.8.0

- **More animations:** 13 new entrances (Shrink In, Blur In, two flips, Rotate In, Drop In, Bounce In, four wipes, Circle In, Glitch In), their 13 exits, and 10 new emphasis effects (Heartbeat, Wobble, Tada, Rubber Band, Jello, Float, Vertical Shake, Spin, Flicker, Glitch).
- **More carousel transitions** for pages and characters: Zoom Through, Zoom Back, Blur, Flip Horizontal, Flip Vertical, Rotate, Drop, Wipe Left/Right/Up/Down, Circle Reveal and Glitch. Wipes and the circle reveal the new page over the old one; flips, Rotate, Drop and Glitch play the old page out, then the new one in.
- **New easings:** Anticipate, Overshoot, Anticipate and Overshoot, Snappy and Stepped, for effects and value transitions.
- Wipes and circles on a layer cut to a shape fade instead, so the shape stays.

## 0.7.0

- **Character colors** window (module settings, or the editor's sidebar): a color for each value of a field — a CAIN blasphemy, a class, any text or mapped field, so it works for every game system — and a color for each character. A character's own color wins, then its value's color, then the game system's. Names, accents and the Discord voice glow follow.
- CAIN: the sheets' pure magenta (Sympathy, Palace, Jaunt) now shows as violet `#9966ff` instead of fuchsia; change it per blasphemy in Character colors.
- Adapters may name an `accentKeyField` that color rules use by default; new API `getAccentRules`, `setAccentRules` and `openCharacterColors`.

## 0.6.0

**Systems and data**
- Native CAIN 1.3.x character fields (CAT, Psyche, Bursts, Stress, Injuries, Divine Agony, Sin Overflow, Kit Points, skills and more), characters colored by their blasphemy, Russian CAIN catalog names on the stream page when cain-ru is installed.
- D&D5e 5.3.x player character adapter, data provider selection, grouped field discovery and mapping previews.
- Character profiles: accent color, full name and full-body art per character, shared by every widget.
- Opt-in CAIN example designs; the OBS viewer account may have any role.

**Editor**
- English and Russian interface, switchable per client.
- Multi-layer selection, alignment and distribution, groups, rotation handle, rulers, guides and grid, Alt distances, snapping to layers, the canvas and equal spacing, full-screen canvas.
- Copy, cut and paste through the system clipboard (also between worlds), undo/redo for 100 steps, saved versions per overlay, reusable fragments with previews.
- Image files dropped or pasted onto the canvas become layers; Foundry's configured fonts on the editor and the stream.
- Text that fits its box, shapes, image masks, faded edges and gradients, rescaling a layout to a new resolution.
- Export and import of overlays, widget designs and fragments as files; imports never overwrite, carry character names and let you pick this world's characters for missing ones.
- Edits update the preview and OBS layer by layer, so carousels and animations keep running.

**Stream**
- Optional OBS connector that signs OBS in automatically and reloads the stream page after Foundry restarts.
- Discord voice: layers glow in a player's or character's color while that player speaks and can appear only while they are in the channel; Discord players window and live preview in the editor.
- Fade-over page transitions, vertical circle indicators, player avatars and stream stability fixes.

## 0.5.x

- Animations (entrance, exit, emphasis), value transitions, triggers on character data and GM Live Controls.
- Coordinated character and information-page carousels for widget instances.

## Earlier versions

- Visual overlay editor with backgrounds, image and text layers, presets and authenticated OBS output.
- Reusable character widget designs bound to world Actors.
