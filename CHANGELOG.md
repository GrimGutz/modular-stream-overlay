# Changelog

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
