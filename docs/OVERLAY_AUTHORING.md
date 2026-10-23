# Overlay authoring toolkit

Create new overlay layouts as JSON, generate a validated bundle, then install it through the running module as a GM. The toolkit uses the existing schema, stores, editor, renderer, animation engine and carousel. It does not edit Foundry databases or publish an overlay during generation.

## Generate and validate

Run from the canonical installed module root. No package installation or build step is needed.

```powershell
node tools/overlay-author.mjs generate examples/authoring/basic.json --out work/generated/basic.json
node tools/overlay-author.mjs validate work/generated/basic.json
node tools/overlay-author.mjs generate examples/authoring/character.json --actor hero=Actor.ACTUAL_ID --out work/generated/character.json --macro work/generated/character.macro.js
node tools/overlay-author.mjs generate examples/authoring/animated.json --out work/generated/animated.json
```

`Actor.ACTUAL_ID` is illustrative: replace it with the actual world Actor UUID. Repeat `--actor slot=Actor.ID` for multiple assignments. Omit it to leave an Actor slot unresolved in the generated bundle and supply the assignment during installation. Generation does not look up Actors or test viewer permissions. Optional `--macro <path>` also writes a ready-to-use GM Script Macro containing that bundle and the import dialog call.

Output files must be new. Add `--force` to regenerate an existing local output file; this flag never permits replacing Foundry records. The three examples use stable, distinct IDs. The character examples target **CAIN 1.3.26**; change their bindings for another system. Bundles target the installed module's **overlay schema 6 / widget schema 4**. Runtime import rejects incompatible schemas rather than guessing a migration.

To reference a design that already exists in the target world, declare a named `presetRefs` entry and use `presetId: "$preset:card"` on the instance. Supply its actual preset ID with `--ref card=existing-preset-id`. Repeat `--ref` as needed. A missing preset reference is a generation error; it cannot be inferred from a display name. Referencing an existing preset does not include or overwrite that preset.

The examples cover a static layout, a reusable character design, and animation/page cycling. Generated output under `work/` is a local artifact. Creating or validating it does not install anything in the world.

## Source format

An authoring source is a plain JSON object:

```json
{
  "format": "mso-authoring",
  "version": 1,
  "actors": { "hero": "World character to display" },
  "widgetPresets": [
    {
      "id": "author-hero-card",
      "name": "Author — Hero Card",
      "canvas": { "width": 400, "height": 180 },
      "layers": [
        { "id": "card-bg", "type": "color", "width": 400, "height": 180, "color": "#14213a", "z": 0 },
        { "id": "card-portrait", "type": "character-portrait", "x": 12, "y": 12, "width": 128, "height": 128, "z": 1 },
        { "id": "card-name", "type": "character-name", "x": 152, "y": 20, "width": 236, "height": 42, "fontSize": 27, "z": 2 },
        { "id": "card-stress", "type": "resource-bar", "x": 152, "y": 94, "width": 236, "height": 32, "binding": "character.stress.current", "maxBinding": "character.stress.max", "z": 3 }
      ]
    }
  ],
  "overlays": [
    {
      "id": "author-hero-scene",
      "name": "Author — Hero Scene",
      "canvas": { "width": 1920, "height": 1080 },
      "layers": [
        { "id": "hero-card", "type": "character-widget", "presetId": "author-hero-card", "actorUuids": ["$actor:hero"], "x": 100, "y": 780, "width": 400, "height": 180 }
      ]
    }
  ]
}
```

`actors` and `presetRefs` map slot names to short human-readable descriptions, not actual Documents or system paths. `$actor:hero` is an assignment placeholder in `actorUuid` or `actorUuids`, not a template token or a component binding. `$preset:card` is a placeholder in an instance's `presetId`. Use a literal included preset ID when the design is supplied in `widgetPresets`.

Widget presets describe reusable content and carry no Actor assignment. Character-widget layers in overlays hold the assignments and placement. `actorUuids` is authoritative when present; do not set a conflicting `actorUuid` alias. Use valid world Actor UUIDs only. An assignment can be a literal UUID or `$actor:name`, including entries in an ordered `actorUuids` list. `carousel.actorStartUuid` also accepts an Actor slot. Placeholders are not arbitrary substitutions inside other settings or strings.

Sources use layer patches over the real defaults from [layers.js](../scripts/core/layers.js). Supply stable IDs for the new records and important components, then specify the geometry and appearance you need. The generator fills schema defaults and rejects unknown keys rather than silently accepting invented presentation fields. Use the current schema as the field reference; additional CSS, HTML and executable expressions are not part of this format.

## Layers and real fields

All layers support `id`, `type`, `name`, `visible`, `locked`, `x`, `y`, `width`, `height`, `rotation`, `opacity`, `z`, `animations` and `triggers`. Coordinates are logical canvas pixels; `z` controls stacking. Defaults are visible, unlocked, x/y/rotation 0, opacity 1; omitted z follows input order. Specify widths/heights explicitly for deliberate layouts, especially instances referencing an existing external preset (otherwise 400×180 is used). New included preset instances inherit their design dimensions.

| Type | Additional fields |
| --- | --- |
| `color` | `color` as hexadecimal or `transparent`. |
| `image` | `src`, `fit`, `lockAspectRatio`. |
| `text` | `text`, `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, `shadow`. |
| `character-name`, `dynamic-text`, `dynamic-number` | Text fields above plus `binding`, `fallback`. A blank template displays the bound field. |
| `character-portrait` | `binding`, `src` fallback, `fit`, `portraitSource`, `circular`, `borderRadius`, `lockAspectRatio`. |
| `resource-bar` | `binding`, `maxBinding`, `foregroundColor`, `backgroundColor`, `showValue`, `display: "bar" | "dots"`, `fallback`, and text styling. |
| `character-widget` | `presetId`, `dataSource`, `actorUuid`/`actorUuids`, `carousel`, supported per-component `overrides`, `animationOverrides`. It belongs in an overlay, not inside a reusable preset or page. |

### Optional presentation fields

These fields are omitted unless set; older layouts keep their exact look. The designer shows them under **Box style**, **Shape and mask**, **Discord voice**, **Text layout** and **Circles**; clearing a field restores the default.

| Applies to | Fields |
| --- | --- |
| Every layer, including `character-widget` | `borderWidth` (0–64 px), `borderColor`, `cornerRadius` (px), drop shadow `boxShadowX`, `boxShadowY` (−200–200), `boxShadowBlur` (0–200) and `boxShadowColor`. The shadow is drawn only when `boxShadowColor` is set. Shape and mask: `clipShape: "circle" | "ellipse" | "hexagon" | "diamond" | "triangle" | "chamfer" | "parallelogram"` with `clipSize` (corner cut or slant, 0–2000 px, default 24), `maskSrc` (an image in Foundry's files whose transparency hides the layer) and `fadeEdge: "top" | "bottom" | "left" | "right" | "vertical" | "horizontal"` with `fadeSize` (1–100 %, default 25). Discord voice: `voiceTarget: "user" | "actor" | "slot"` (a Discord user, the player linked to the layer's character in the world's Discord players, or the Nth unlisted person in the channel) with `voiceUser` (a Discord user ID, digits only, for `user`) or `voiceSlot` (1–20, default 1, for `slot`), `voiceColor` (glow color), `voiceShow: "always" | "present" | "speaking"` and `voiceEffect: "glow" | "none"`. Voice fields without a `voiceTarget` are dropped. Discord IDs belong to a world, so reusable designs should prefer `actor` or `slot`. |
| `color` | `gradientTo` (a second color: the fill runs from `color` to it), `gradientType: "linear" | "radial"` and `gradientAngle` (0–360°, default 180 = top to bottom). |
| `text` and dynamic text types | `lineHeight` (0.5–5, multiplier), `letterSpacing` (px), `uppercase`, `verticalAlign: "top" | "middle" | "bottom"`, `padding` (px), `highlightColor` (background behind the text itself, e.g. a black name label), `richText` with `strongColor` and `strongFontSize`, `autoFit` (shrink the font, and bold text with it, until the content fits the box) and `minFontSize` (the smallest it may go, default 6). |
| `character-name`, `dynamic-text`, `dynamic-number` | `accent` (text uses the character accent), `strongAccent` (bold parts use it), `emptyText`, `hideEmptyLines`, `valueLabels`. |
| `resource-bar` | `accent` (fill), `maxValue` (fixed 1–60 circles instead of the maximum field), `dotSize`, `dotGap`, `dotBorderWidth`, `dotDirection: "right" | "down" | "up"` (a row, or a column filling from the top or from the bottom). |
| `character-portrait` | `imagePosition: "center" | "top" | "bottom"` for cropped artwork. |

With `richText: true`, `**text**` is bold within one line. Markup is read from the template before values are inserted, so Actor text never becomes markup. `hideEmptyLines` omits a template line when any of its fields is an empty text; unavailable values still show `fallback`. `emptyText` replaces a blank result, for example `"ЧИСТ"` for no sin marks; it never replaces unavailable data. `valueLabels` holds `value=label` lines, used by `{field|label}` tokens: `{character.cain.cat|label}` with `1=1 - Чёрт` shows `1 - Чёрт`, and unlisted values show the value itself.

Colors are hexadecimal; 8-digit colors such as `#00000059` carry transparency. A resource with `backgroundColor: "#00000000"` and `dotBorderWidth: 0` draws fill-only circles over printed artwork.

### Character profiles

`character.profile.accent`, `character.profile.fullName` and `character.profile.art` come from the module's **Character profiles** world setting, not from the game system. A GM edits them from a widget instance (**Character profiles…**); one profile per world Actor is shared by every overlay. An unset accent uses the system adapter's character color (CAIN: the blasphemy color); without either it is empty and layers with `accent: true` keep their own color. `character.profile.art` falls back to the player's avatar (`character.playerAvatar`: the non-GM user whose assigned character this is, otherwise a non-GM owner; Foundry's placeholder avatar counts as none), then to the Actor portrait.

Actor names written as `Callsign (First Last)` provide `character.callsign` (the part before the parentheses) and `character.realName` (the part inside). A name without parentheses is entirely the callsign, with an empty real name. A profile full name replaces `character.realName`.

Use flat properties such as `fontSize: 28` and `rotation: 12`; there are no `style`, `position`, `transform`, `resourceId`, `actorName` or arbitrary CSS properties. Font weights are strings `"400"`, `"600"`, `"700"`; fonts are Arial, Verdana, Georgia, Times New Roman, Courier New, Trebuchet MS or any font configured in Foundry (its bundled fonts and **Configure Fonts**), written as the plain family name. Text alignment is left/center/right. Image fitting is cover/contain/stretch; portraits accept cover/contain. Portrait artwork selects `profile` or `token` (prototype-token artwork).

Resource indicators default to the existing continuous `display: "bar"`. Choose `display: "dots"` for one outlined circle per resource unit when the bound maximum is an integer from 1 to 60. `foregroundColor` fills circles and `backgroundColor` colors their outlines. Zero draws empty circles; fill clamps to the available units without altering the displayed source number. Fractional current values partially fill the next circle. Larger or fractional maxima use the continuous bar, keeping DOM allocation bounded. Missing values never become fabricated zeroes. The widget designer exposes this option as **Resource display / Вид индикатора**.

Image/background `src` references an existing managed relative path such as `modules/modular-stream-overlay/assets/demo-warrior.svg`. Do not embed image data, OS file paths or remote static-image URLs. Generation does not copy assets. Preserve the user's images and `storage/`.

Bindings use normalized `character.*` IDs. Text templates use literal tokens such as `"{character.name} — Stress {character.stress.current}/{character.stress.max}"`; plain `text` layers do not resolve them. System paths such as `system.stress.value` belong in adapters or explicitly configured field mappings, never in a widget binding. Unknown fields remain saved but render unavailable. Use [CAIN.md](CAIN.md) and [DND5E.md](DND5E.md) for current field names and exact version/type limits.

Useful bounds: canvas width/height 64–7680 integers; layer width/height 1–7680; x/y −32768–32768; rotation −360–360 degrees; opacity 0–1; integer z −10000–10000; text 10000 characters; fallback 1000. IDs are at most 96 ASCII letters/digits/`_.:-`, beginning with a letter/digit. Components must have unique IDs across a preset's shared layers and all its pages. Each preset supports at most 100 components and 20 pages; each instance at most 20 unique Actors.

## Animation and carousel

Use the existing nested animation configuration, for example:

```json
{
  "animations": {
    "entrance": { "type": "fade-in", "duration": 600 },
    "exit": { "type": "fade-out", "duration": 600 },
    "emphasis": { "type": "pulse", "duration": 1000, "intensity": 1 },
    "transition": { "duration": 350, "easing": "ease-out", "numeric": true, "bar": true }
  }
}
```

Effects use `duration`/`delay` in milliseconds, `easing: linear|ease-in|ease-out|ease-in-out`, `direction: normal|reverse|alternate`, intensity 0–2 and integer repeat 1–20. Duration is 1–10000 ms; total delay plus duration × repeat cannot exceed 60000 ms. Value transition duration may be zero. Built-ins include fade-in/out, directional slide-in/out, scale-in/out, pop-in, pulse, flash, shake, bounce, glow, color-flash and scale-pulse. Persistent effects require a valid continuous trigger rule, not an unbounded repeat count.

Preset-level motion applies to the grouped widget by default. An instance's authored motion needs `animationOverrides: true` to replace inherited preset settings/rules. Component rules remain independent. Keep effect state out of saved data; do not add runtime progress or active Animation objects. See [EXTENDING.md](EXTENDING.md#animations-and-triggers) for supported declarative events, conditions and actions.

Each preset page is `{id,name,enabled,duration,skipIfUnavailable,layers}`. Page layers use the same real component fields; pages cannot recursively contain pages or widget instances. Put persistent identity/portrait components in shared `layers` and changing information in page `layers`.

Preset `cycling` supports `enabled`, `mode`, `traversal`, `duration`, `loop`, `startPageId`, `transition`, `transitionDuration`, `characterTransition` and `characterTransitionDuration`. Modes are static/information/character/combined; traversal is pages-first/characters-first. Transition kinds are fade, fade-over, slide-left/right/up/down, scale and instant. `fade-over` fades the incoming page in above the outgoing one and hides the outgoing page afterwards, so content repeated on consecutive pages never dims; for character changes it behaves like fade. Dwell is 100–3600000 ms and begins after preparation/transition; transition duration is 0–10000 ms. A page's non-null duration overrides the preset dwell.

Instance `carousel` contains optional overrides of these settings plus `actorStartUuid`, `pageOrder` and `pageDurations`. Null overrides inherit the design. Automatic cycling defaults off; explicitly enable it when needed. A `startPageId` must reference a real page. A page with `skipIfUnavailable: true` needs valid bound information; a page containing only static decoration will not become available merely because it is visible. Existing [CAROUSEL.md](CAROUSEL.md) explains timing, eligibility and navigation.

## Bundle and installation

The generated bundle declares `format: "mso-overlay-bundle"`, `version: 1`, `moduleId: "modular-stream-overlay"`, `overlaySchemaVersion: 6`, `widgetPresetSchemaVersion: 4`, `actorSlots`, normalized `widgetPresets` and `overlays`. `actorSlots` lists declared slot names; the importer asks only for used unresolved slots.

Deferred assignments are represented separately by `actorBindings` records with `overlayId`, `layerId`, ordered `actors` entries (literal UUIDs or `$actor:name`) and optional `startActor`. This preserves ordering when assigned UUIDs and unresolved slots are mixed. Generation replaces supplied slots in this metadata, removes unresolved entries from normalized `actorUuids`, and defers an unresolved starting Actor. Runtime installation resolves the complete sequence and validates the overlay again. Preserve this binding metadata when transporting the bundle; do not import the authoring source as a normalized overlay.

The shortest UI path is to generate `--macro work/generated/character.macro.js`, copy that file's contents into a **Script Macro** in Foundry, and run it as GM. The macro contains the generated JSON and calls `importOverlayBundle({bundle: ...})`. It opens a summary and unresolved Actor inputs; it does not install on execution without the explicit **Install** action.

The import helper can also be called with a bundle already held in a local variable:

```js
const { importOverlayBundle } = await import(
  foundry.utils.getRoute("modules/modular-stream-overlay/scripts/authoring/bundle.js")
);
await importOverlayBundle({ bundle });
```

The importer asks for unresolved Actor slot UUIDs, displays a summary, and installs only after the explicit **Install** action. Characters need Observer access for the configured overlay viewer; the importer must not substitute GM permissions for the viewer. It does not create or alter Actor/Item documents.

For programmatic validation and installation:

```js
const { installOverlayBundle } = await import(
  foundry.utils.getRoute("modules/modular-stream-overlay/scripts/authoring/bundle.js")
);
await installOverlayBundle(bundle, { actors: { hero: "Actor.ACTUAL_ID" }, dryRun: true });
// After reviewing the validation result:
await installOverlayBundle(bundle, { actors: { hero: "Actor.ACTUAL_ID" } });
```

To update designs from a newer bundle, run the same import again. When widget presets or overlays with the bundle's IDs already exist, the dialog lists the designs it will replace and the overlays it keeps, and its button becomes **Update**. Replaced presets lose edits made to them in the designer; kept overlays retain their layers, text and Actor assignments, and need no Actor choices. Programmatically this is `installOverlayBundle(bundle, { updateExisting: true })`; without it, existing IDs are still rejected.

`dryRun` validates without installing. Generation/CLI validation cannot confirm the target world's existing IDs, referenced presets, Actors or permissions; runtime validation performs those checks. Existing overlay/preset ID collisions are rejected. Use fresh IDs in the source and regenerate rather than overwriting another design. Installation uses the existing stores, adds the bundle records and leaves the active overlay unchanged. Multiple store writes are not one atomic transaction: if a write fails, inspect which new records were saved before retrying. Select the new overlay for preview and, when ready, choose it in **Active on stream** separately.

Generation, a valid bundle and successful installation do not prove visible runtime behavior. Review the new design in the real editor; verify dimensions, Actor fields, repeated page/character cycling, entrance/exit/Pulse and cleanup. Check the authenticated OBS Browser Source separately. Report exactly which environments were exercised. Run `npm run check` and `npm test` from the canonical root after source changes; never change the renderer, transport, databases or system configuration merely to author a layout.

Verified on 21 October 2026: all three templates generate and validate against the actual schemas; six toolkit tests cover compilation, Actor ordering, CLI and installation through real stores in memory. The full module suite passed **415/415** tests and `npm run check` passed. Basic Overlay also passed `dryRun: true` in the running TEST world (Foundry 14.368, module 0.6.0), with overlay/preset settings unchanged. No generated records were installed in the real world; new layout rendering in OBS was not tested. Local dry-run evidence is `work/authoring-foundry-dryrun.json`.
