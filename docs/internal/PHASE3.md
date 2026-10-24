# Phase 3: reusable live character widgets

This guide describes version **0.3.0**, implemented in the existing installed module at `C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay`. Existing source, saved overlay structures, backgrounds, uploaded files, and full-overlay presets remain supported. No separate module or companion service is required.

## What is available

There are three separate concepts:

| Concept | Purpose |
| --- | --- |
| Widget definition | Describes an available component type, such as a portrait, dynamic text, or resource bar. |
| Widget preset | A reusable design with its own dimensions, component layout, styles, and normalized field bindings. It has a stable ID and contains no persistent character assignment. |
| Widget instance | A grouped layer on an overlay. It references a preset ID and its own world Actor UUID, position, dimensions, visibility, opacity, order, and optional component style overrides. |

The Widget Preset Manager is separate from the existing full-overlay preset controls. It supports creating, renaming, editing, previewing, duplicating, and deleting designs. Two initial examples are ordinary editable records: **Basic Character Card** and **Compact Character Card**. Deleting an example does not cause it to be recreated on the next load.

The designer reuses the existing visual editor, coordinate model, layer controls, keyboard shortcuts, and shared renderer. Components include static image/text layers, color decorations, character portraits, character names, dynamic text, dynamic numbers, and horizontal resource bars. A widget placed on the main overlay moves and resizes as one layer; its internal design uses local coordinates and scales with the group.

## Prepare the viewer and Actors

1. Keep the existing authenticated OBS setup described in [README.md](../../README.md#obs-browser-source-setup). The viewer must be the configured dedicated **Player** account, never a GM or Assistant GM account.
2. Grant that user **Observer** permission on each world Actor intended for the stream. Limited access is insufficient. No assigned user character or Owner permission is needed.
3. Select and save the viewer account in the overlay editor before choosing preview characters or assigning Actors.

The GM preview deliberately checks the configured viewer's Actor access. A GM being able to open an Actor does not make it streamable. The picker lists permitted world Actors with names and portraits and provides a search box. Missing permission produces an editor warning and safe fallback content.

## Create a reusable design

1. Open **Widget Preset Manager** from the overlay editor sidebar or module settings.
2. Choose **Create widget preset**, or **Edit / preview** an existing design. Use **Duplicate** to experiment with an independent copy.
3. Set the local canvas width and height. New designs default to **400 × 180** pixels. These are design coordinates, separate from an overlay's usual 1920 × 1080 canvas.
4. Add a **Character portrait** and **Character name**. Add static image/text layers or a **Color background** for decoration.
5. Add **Dynamic text**, **Dynamic number**, or **Health / resource bar** components where supported. Select a component to choose its character field in Properties. Numeric components and bars offer numeric fields from the active adapter.
6. Drag and resize components, enter rotation numerically, set text styles, and arrange the layer stack. Visibility, locking, duplication, deletion, zoom, and native-pixel keyboard movement follow the existing editor behavior.
7. Use **Preview with character** to see current permitted values. This preview Actor is temporary and is not stored in the preset.
8. Click **Save widget design**. Geometry and style edits remain a private draft until saved. Existing instances linked to this preset then receive the saved design while retaining their Actor UUIDs and overlay placement.

Portraits support cover/contain, opacity, circular clipping, corner radius, profile or prototype-token artwork, and an optional managed fallback image. If prototype-token artwork is unavailable, the profile portrait can be used as a safe fallback. The explicit `character.tokenPortrait` field remains unavailable when no token artwork exists.

Dynamic text and names use the existing safe text styling controls. A blank template displays the selected field. Templates may combine plain text with normalized references, for example:

```text
HP: {character.hp.current}/{character.hp.max}
{character.name} · Level {character.level}
```

Use **Insert field into template** to insert supported tokens. Templates are rendered through `textContent`; HTML-like text is literal. There is no JavaScript expression evaluation, unrestricted Actor-path interpolation, or raw HTML binding. Unsupported or missing values use the component's fallback text.

Resource bars fill horizontally only when both selected fields resolve to finite numbers and the maximum is greater than zero. Fill is clamped to 0–100%. A missing or zero maximum produces an editor placeholder and no pretend live health bar in broadcast output. Bars have configurable foreground/background colors and optional current/maximum text. They can represent supported resources other than health by choosing another current/maximum pair.

## Add and reuse a widget

1. Open an overlay and choose **Add widget**.
2. Choose a shared design, then assign a character in the searchable picker. Leaving the character blank creates an unassigned instance with safe placeholders.
3. Move, resize, rotate, reorder, show/hide, lock, or change the opacity of the entire card in the overlay editor.
4. Duplicate the card and choose **Assign / change character** on the copy. The copy keeps the same preset reference but has its own Actor UUID. Rebinding one card does not change another card or its source design.
5. Click **Save overlay** to publish these instance changes to the selected saved overlay.

There are three assignment methods:

- **Picker:** search names and select a permitted Actor and portrait.
- **Drag and drop:** drag an Actor from Foundry's Actor Directory onto the widget's canvas box or selected configuration area.
- **Document reference:** paste a world UUID such as `Actor.abc123` or a supported document link such as `@UUID[Actor.abc123]{Character name}`, then apply the link.

References resolve asynchronously through Foundry's public UUID API and are validated as world Actor documents. External URLs, compendium references, and synthetic/unlinked Token Actor UUIDs are rejected. **Clear character** removes the assignment without changing the card design. **Edit shared design** opens the linked preset.

The editor preserves per-component style overrides stored through the model/API, but does not yet expose a separate override inspector. Shared design updates preserve those overrides. Deleting a source design leaves references and Actor assignments intact; the editor shows a missing-design placeholder, and that instance produces no broadcast content until the design is restored or the instance is replaced.

## Available fields and systems

Generic Actor basics are available on all game systems when the viewer can observe the Actor:

| Field ID | Type | Meaning |
| --- | --- | --- |
| `character.name` | Text | Actor name |
| `character.portrait` | Image | Profile image, or prototype-token artwork when selected as the portrait source |
| `character.tokenPortrait` | Image | Explicit prototype-token artwork, when present |
| `character.uuid` | Text | World Actor UUID |
| `character.type` | Text | Actor document type |

The built-in **CAIN** adapter targets the public TypeDataModel definitions inspected in installed CAIN **1.3.26**, specifically `module/data/base-actor.mjs` and `module/data/actor-character.mjs`. It adds these numeric fields:

| Field ID | Meaning |
| --- | --- |
| `character.hp.current`, `character.hp.max` | Health and maximum health |
| `character.hp.percent` | Health percentage, clamped to 0–100 when the maximum is valid |
| `character.level` | Level |
| `character.power.current`, `character.power.max` | Power and maximum power |
| `character.stress.current`, `character.stress.max` | Stress and maximum stress |
| `character.psyche` | Psyche |

Only fields actually present as valid values on the selected Actor are displayed. There are no fabricated class, AC, ability score, or resource values. CAIN-specific support is code/schema coverage; it has not been verified by a live CAIN/OBS session in this environment.

Other systems use generic fields until a compatible adapter or explicit mapping supplies more. Dedicated D&D 5e and Pathfinder 2e adapters are not included. The component UI obtains field labels/types from the active adapter and mappings rather than hardcoding a system's internal data paths.

### Advanced mappings

The manager's **Advanced field mappings** dialog accepts a JSON array configured by the GM. Each mapping has a normalized `character.*` ID, a label, type `number` or `string`, and an explicitly chosen public `system.*` path from that system's documented Actor schema. Up to 64 mappings are supported. For example, if the system actually documents this field:

```json
[
  {
    "id": "character.focus.current",
    "label": "Focus",
    "type": "number",
    "path": "system.resources.focus.value"
  }
]
```

That path is illustrative, not a promise that any installed system has it. The service reads only mappings explicitly used by components. Missing fields remain unavailable. Mappings may replace system-adapter fields, but cannot replace generic Actor basics. Numeric `character.hp.current` and `character.hp.max` mappings also make a derived `character.hp.percent` available when possible.

Paths cannot traverse arbitrary document properties or include prototype keys, expressions, private fields, notes, biographies, descriptions, flags, ownership, or permission properties. Ordinary widget users choose the resulting field from the inspector; they do not need to write paths or JavaScript. Additional dedicated adapters should be added against public system schemas with fixtures, as described in [EXTENDING.md](../EXTENDING.md).

## Live updates and security

Each authenticated client resolves the current Actor at component mount time, including when OBS first opens or reloads after reconnecting. Only selected supported normalized scalar fields are returned to the rendering layer. The renderer receives no Actor document and does not read system paths itself.

The data service subscribes to documented Actor create/update/delete hooks, Item and ActiveEffect changes that can affect a parent Actor, linked-token changes, and viewer User permission/account changes. It tracks subscriptions by Actor UUID and batches rapid notifications with a short debounce. Affected components refresh from current permitted data; normal character updates do not rebuild unrelated widgets or the full overlay. Stale asynchronous reads cannot overwrite a newer result, and component cleanup removes subscriptions.

Design/overlay configuration changes use the existing world-setting notifications. Actor changes reach each authenticated client through Foundry's normal document database updates; this module adds no raw Actor socket broadcast or unauthenticated data endpoint. The stream view initializes the Actor collection and database listeners before the module mounts at `streamReady`. Its initial mount resolves a complete current presentation instead of waiting for a later update event.

Permission checks use the configured viewer identity for GM previews and the same selected viewer in OBS. Access is checked before normalization and again after asynchronous resolution. Missing/deleted Actors and revoked access produce safe placeholders and editor warnings. Portrait image references accept managed files or credential-free HTTP(S) Actor artwork. Passwords and privileged tokens never belong in output URLs or preset data.

Foundry's authenticated Player session still receives whatever documents Foundry normally permits that account to access. This module's selected-field filtering does not replace Foundry permissions or make an Observer session data-free. Keep the viewer's access limited to intended stream Actors. Installed extensions remain trusted client code. The configurable mapping service excludes private document paths, and the module stores neither complete Actor copies nor hidden GM notes in presets.

## Persistence and compatibility

The main world setting, `modular-stream-overlay.state`, now uses **schema 3**. Schema-1 and schema-2 overlays and full-overlay presets normalize to isolated schema-3 copies in memory. Opening an editor or rendering output does not write a migration. An explicit save or other store mutation persists the validated current state. Existing layer IDs, static fields, image references, legacy widgets, adapter configuration, preset contents, and active-overlay selection are preserved.

The separate world setting, `modular-stream-overlay.widgetPresets`, uses this version-1 shape:

```json
{
  "schemaVersion": 1,
  "revision": 0,
  "presets": [
    {
      "schemaVersion": 1,
      "id": "widget-preset-example",
      "name": "Character card",
      "canvas": { "width": 400, "height": 180 },
      "background": { "src": "", "opacity": 1, "fit": "cover" },
      "layers": []
    }
  ]
}
```

A preset design cannot contain nested `character-widget` instances. The shared conversion helpers adapt designs to/from ordinary overlay drafts for the visual editor. Widget preset IDs are stable across edits. Each instance stores only the shared preset reference, Actor UUID, common layer properties, and optional allowlisted style overrides.

Saving/loading a full-overlay preset preserves widget references, positions, dimensions, Actor UUIDs, visibility, order, locks, opacity, rotation, and overrides. Actor values are resolved dynamically after loading. Widget designs are kept in their separate library rather than embedded in every instance or full-overlay preset; copying a full-overlay configuration to another world does not also transfer that library.

Both stores use independent revisions, GM-only mutations, validated isolated reads, and stale-draft checks. The public Foundry world-setting API does not provide an atomic lock between truly simultaneous GM clients. Use one writer at a time. Limits remain bounded: 100 overlay layers, 100 widget presets, 100 components per design, canvas sides 64–7680 pixels, layer sides 1–7680 pixels, and 2 MB per settings collection. See [EXTENDING.md](../EXTENDING.md) for exact fields and APIs.

## Validation and remaining runtime acceptance

Run these checks in the canonical installed module folder:

```text
npm run check
npm test
```

The automated suite covers model migration, complete full-overlay preset round trips, shared preset references with independent Actor bindings, style override filtering, both stores' permissions/revisions, safe templates, adapter fields, Actor reference validation, permission revocation, lifecycle hooks, debounce, cleanup, resource fallbacks, grouped rendering, stale asynchronous results, and mocked editor workflows. Static validation checks local imports, manifest entries, and JavaScript syntax. Mocked Foundry/DOM tests are not a live Foundry or OBS session.

On **2026-10-20**, the final installed source passed `npm run check` (**36 JavaScript files**) and `npm test` (**158 tests: 157 passed, 0 failed, 1 skipped**). The skipped fixture requires Windows symbolic-link permissions unavailable in this environment. These checks ran directly in the canonical installed module folder. The editor and widget manager templates also compiled with the installed Foundry Handlebars package; template compilation does not establish live application behavior.

**Live Foundry/OBS testing has not been performed for this phase.** Earlier browser attempts could not launch the local Chromium harness or reach it from the provided browser environment. No live visual, Actor-update, permission, or OBS reconnect pass is claimed. The checklist below remains unverified until exercised.

### Manual acceptance checklist

Record the Foundry build, system/version, OBS version, browser, enabled modules, and results.

- [ ] Restart Foundry and refresh the GM/OBS clients once; load an existing overlay with its original background, images, text, and presets intact.
- [ ] Give the configured Player viewer Observer access to Actors A and B; confirm other Actors are excluded from the picker.
- [ ] Create, rename, duplicate, preview, save, reopen, and delete widget presets. Confirm deleted examples do not return after restart.
- [ ] Design a card with a portrait, character name, safe template, static decoration, and a supported resource bar. Exercise drag/resize/rotation/zoom, layer visibility/locking/order, and keyboard focus.
- [ ] Preview a character, save the design, reopen it, and confirm the preview Actor was not stored as a design binding.
- [ ] Add the same preset twice; assign A and B. Confirm different data and independent Actor UUIDs.
- [ ] Test picker search, Actor Directory drag/drop, plain UUID, and `@UUID` document-link assignment. Reject external, compendium, and synthetic Token references.
- [ ] Duplicate a widget, reassign only the copy, and save. Confirm all other bindings and positions remain unchanged.
- [ ] Move and resize the card as one group; save and compare Foundry preview with authenticated OBS. No editor handles, warnings, checkerboard, or controls should appear on air.
- [ ] Rename an Actor and change its portrait and supported health/resource values. Confirm its components update in OBS and unrelated character widgets retain their values and geometry.
- [ ] Change an Item/ActiveEffect that affects a supported value. Confirm the relevant world Actor widget refreshes without continuous polling.
- [ ] Edit and save the shared preset style. Confirm all linked instances update appearance while retaining their own Actors, placements, and supported overrides.
- [ ] Test missing fields, unsupported HP, zero maximum, negative/current-over-maximum values, missing artwork, deleted Actors, and revoked Observer permission. Confirm warnings/fallbacks and no crashes or fabricated bars.
- [ ] Save/load a full-overlay preset containing widgets; confirm references and bindings are restored and values are fetched fresh.
- [ ] Restart Foundry; confirm both preset libraries and instance bindings persist. Open OBS anew and verify current data without first editing an Actor.
- [ ] Disconnect/reconnect OBS, revoke or change the viewer account, and confirm output clears/reconstructs through the existing secure lifecycle.
- [ ] Repeat the upload, saved-vs-draft, inactive overlay, and editor conflict checks in [PHASE2-TESTING.md](PHASE2-TESTING.md).

## Source inventory

Phase 3 changes these source areas; user storage and custom assets are outside the source changes:

| Files | Change |
| --- | --- |
| `module.json`, `package.json`, `scripts/main.js` | Version, settings/menu/API wiring, adapter registration, preview/stream lifecycle |
| `scripts/core/schema.js`, `scripts/core/layers.js` | Schema 3, validated dynamic components/grouped instances, definitions, factory and binding validation |
| `scripts/core/widget-presets.js` | Separate versioned design store, example records, conversions, revision/GM checks |
| `scripts/core/registry.js` | Adapter field definitions and metadata |
| `scripts/adapters/generic.js`, `scripts/adapters/cain.js` | Permitted generic Actor fields and CAIN resources |
| `scripts/data/bindings.js`, `scripts/data/mappings.js`, `scripts/data/character-data.js` | Safe tokens, selected field resolution, explicit mappings, permissions, hooks, debounce and cleanup |
| `scripts/render/renderer.js`, `scripts/render/character-components.js` | Shared group rendering, local scaling, live scalar components and safe fallbacks |
| `scripts/ui/editor.js`, `scripts/ui/widget-editor.js` | Existing editor integration, Actor linking, manager, reused design editor and mapping dialog |
| `templates/editor.hbs`, `templates/widget-manager.hbs`, `styles/editor.css`, `styles/renderer.css` | Editor controls, library cards and widget presentation |
| `tests/core.test.js`, `tests/layers.test.js`, `tests/widget-presets.test.js`, `tests/data.test.js`, `tests/character-renderer.test.js`, `tests/editor.test.js`, `tests/widget-editor.test.js`, `tests/boot.test.js` | Model, security, storage, adapter, lifecycle, rendering, instance assignment/rebinding/drop, editor and integration coverage |
| `README.md`, `docs/EXTENDING.md`, `docs/PHASE3.md` | Updated use, developer contracts, limits and acceptance plan |

## Known limits and next phase

- World Actors are supported. Synthetic Actors from unlinked Tokens and compendium Actor bindings are deliberately deferred; linked-token changes only refresh the associated world Actor.
- Generic basics and CAIN fields are implemented. Other systems need explicit mappings or a dedicated adapter. System adapters do not fabricate unavailable fields.
- The advanced mapping dialog is JSON configuration for a GM familiar with the active system's public schema. Ordinary component field selection is visual.
- The model preserves allowlisted instance style overrides; a dedicated override inspector, preset import/export, automatic user-character assignment, undo/history, and combat tracking are not included.
- Font availability and portrait file reachability can differ between machines. Static text resizing changes its box; scaling a grouped widget scales the design as a whole.
- Live Foundry/OBS and CAIN runtime acceptance remains outstanding, along with the earlier static editor's visual checks.

The next phase should start with the manual acceptance session, then add dedicated adapters for the user's next game systems and a more approachable mapping interface. Add synthetic Token support only with explicit identity/permission semantics and tests distinguishing world Actor values from per-token values.
