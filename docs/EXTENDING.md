# Extension interfaces

These APIs describe **v0.7.0**, overlay schema **6**, and widget preset schema **4**. Existing widget and adapter registrations remain supported. Register during the module's init event so an extension works in both the regular game and native stream view. `/stream` does not fire Foundry's regular `ready` hook. [CAROUSEL.md](CAROUSEL.md) gives practical character/page editing, unified scheduling, and acceptance guidance. [DEMO_GUIDE.md](DEMO_GUIDE_RU.md) describes the editable demonstration in Russian.

```js
Hooks.once("modularStreamOverlayInit", api => {
  api.registerWidget({
    id: "my-module:caption",
    label: "Caption",
    defaults: { text: "On air" },
    configSchema: { text: { type: "string", label: "Caption text" } },
    render({ element, config }) {
      // Validate your own options. Treat user text as text, never raw HTML.
      element.textContent = String(config.text ?? "");
      Object.assign(element.style, { font: "32px sans-serif", color: "white", padding: "12px" });
    },
    update({ element, config, context, overlay, data }) {
      if (typeof data.caption === "string") element.textContent = data.caption;
    },
    destroy({ element }) {
      // Remove any subscriptions, observers, timers, or other resources created by render.
    }
  });
});
```

Declare a Foundry manifest relationship requiring `modular-stream-overlay` when distributing an extension. Every client must enable the extension, including the stream account's world. Registering a widget does not add an instance or put content live.

## Module API

`game.modules.get("modular-stream-overlay").api` contains:

| Member | Contract |
| --- | --- |
| `version`, `schemaVersion` | API version `0.7.0`, overlay schema version `6` |
| `registerWidget(definition)` | Registers a unique widget; returns a frozen registration |
| `registerAdapter(definition)` | Registers a unique system adapter |
| `widgets`, `adapters` | Registries with `get(id)` and `list()` |
| `store` | Validated persistent overlay/preset operations |
| `widgetPresets` | Separate validated reusable widget preset store |
| `characterData` | Permission-aware selected-field resolution and Actor subscriptions |
| `createOverlay(name)` | New unsaved, system-independent overlay object |
| `validateOverlay(value)` | Returns a sanitized copy or throws `TypeError` |
| `openEditor()` | Renders the GM editor from the regular game view |
| `openWidgetManager()`, `openWidgetPreset(id)` | Open the GM design library or a source preset's visual editor |
| `openVoiceRoster()` | Open the GM's Discord players window (Discord IDs, names, characters and glow colors for voice layers) |
| `openCharacterColors()` | Open the GM's Character colors window |
| `getAccentRules()`, `setAccentRules(rules)` | Read or (GM only) save character color rules `{ field, colors }`: `field` is a text field ID ("" uses the adapter's `accentKeyField`), `colors` maps a field value to `#rrggbb` (at most 200, matched without regard to case; a value listing several names one per line uses the first with a color) |
| `openLiveControls()`, `liveControls` | GM controls for the saved active overlay; see animation contracts below |
| `animations` | Trusted animation/event/action registrations and semantic event dispatch |
| `getAdapterPreferences()`, `setAdapterPreferences(map)` | Read/set explicit system providers; mutation is GM-only |
| `installCainPresets()` | GM-only, idempotent installation of Actor-free CAIN examples without activating output |
| `getFieldMappings()`, `setFieldMappings(value)` | Validated explicit system-field mappings; mutation is GM-only |
| `getViewerUserId()`, `setViewerUserId(id)` | Read/set the selected viewer account (any role); mutation is GM-only; empty string disables |
| `getOBSUrl()`, `getJoinUrl()` | Origin and route-prefix-aware URLs without credentials |

Registration IDs accept printable ASCII letters/digits and `-`, `_`, `.`, `:` (maximum 96 characters, starting with a letter/digit). Namespace your IDs to avoid collisions. Duplicate registrations throw instead of replacing another extension silently.

## Widgets

A widget definition needs `id`, `label`, and `render({element,config,context,overlay})`. `update` and `destroy` are optional and receive the same arguments; `update` additionally receives `data`. Callbacks may return promises. Optional `defaults` and `configSchema` are safe JSON objects. Defaults are shallow-merged with instance configuration; extensions validate their own option types. Schema metadata reserves a place for a future configuration UI.

`context.mode` is `preview` or `broadcast`; broadcast context additionally includes `viewerUserId`. Core renderer contexts also expose `characterData` and `widgetPresets` services. A prepared grouped-widget presentation receives its currently displayed Actor UUID as `actorUuid`; the instance's ordered assignments remain configuration. The renderer supplies no raw Actor/Token document as a render payload. These callbacks are trusted module code, not sandboxed code. Render receives isolated config and overlay copies.

The renderer rebuilds widgets on configuration changes, invokes cleanup for replaced scenes, and ignores late asynchronous renders after a newer scene or clear request. Widget exceptions are logged without removing other widgets. Async functions should finish promptly. Clean up any global listeners yourself in `destroy`. `OverlayRenderer.update(data)` remains an explicit manual update entry point for registered extensions. Built-in character components use their own selected-field subscriptions; registering an extension does not automatically subscribe it to Actor changes. No GM-to-OBS Actor-document socket broadcast is added.

Add a custom registered extension instance through the GM store API. The editor's **Add widget** button is the separate reusable character-design workflow:

```js
const api = game.modules.get("modular-stream-overlay").api;
const state = api.store.getState();
const overlay = state.overlays.find(item => item.id === state.activeOverlayId);
if (!overlay) throw new Error("Create and activate an overlay first.");
overlay.widgets.push({
  id: foundry.utils.randomID(), type: "my-module:caption",
  visible: true, x: 80, y: 80, width: 800, height: 100, opacity: 1, z: 10,
  config: { text: "Welcome to the game" }
});
await api.store.saveOverlay(overlay, { expectedRevision: state.revision });
```

Unknown widget types remain stored and render as empty until the corresponding extension is installed. Widget IDs must be unique within the overlay. Layers and widgets share native-pixel geometry and cross-type `z` order; higher values appear on top. Each box clips overflow. Common defaults are x/y 0, full canvas dimensions, rotation 0 degrees, opacity 1, visible true, locked false, and array index for `z`. Rotation uses the center of the layer box. The lock flag controls editor interaction; it does not hide the rendered element.

## Static and custom layers

`overlay.layers` is an ordered collection with stable IDs. The editor provides image/text creation, selection, drag/resize, ordering, and type-specific controls, with dynamic components in widget-design mode and grouped character instances on full overlays. `color` layers remain valid and are available as design decorations. All use the same `OverlayRenderer` in preview and broadcast. `LayerCanvas` owns preview hit targets, selection borders, handles, zoom, and pointer interactions in a separate editor-only DOM tree. Do not add editor controls inside a renderer layer.

An image layer has this shape:

```json
{
  "id": "layer-frame",
  "type": "image",
  "name": "Portrait frame",
  "x": 80,
  "y": 80,
  "width": 320,
  "height": 320,
  "rotation": 0,
  "opacity": 1,
  "visible": true,
  "locked": false,
  "z": 0,
  "src": "modules/modular-stream-overlay/storage/example.webp",
  "fit": "contain",
  "lockAspectRatio": true
}
```

Any layer may also carry the optional shape and mask styles `clipShape`, `clipSize`, `maskSrc`, `fadeEdge` and `fadeSize`, color layers `gradientTo`, `gradientType` and `gradientAngle`, and text layers `autoFit` and `minFontSize`; any layer may also react to Discord voice through `voiceTarget`, `voiceUser`, `voiceSlot`, `voiceColor`, `voiceShow` and `voiceEffect`. [OVERLAY_AUTHORING.md](OVERLAY_AUTHORING.md) lists their values. Any layer may carry optional `groupId` (an ID) and `groupName` (1–80 characters, kept only with a group ID). Layers sharing a group ID form an editor group; the renderer ignores both fields.

Text layers use the same common fields plus `text`, `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, and boolean `shadow`. `text` supports newlines and is assigned through `textContent`. `fontFamily` is a plain family name: letters, digits, spaces and `_ . ' -`, at most 64 characters, starting and ending with a letter or digit (for example Arial, Times New Roman or a Foundry font such as Modesto Condensed). The editor offers Arial, Verdana, Georgia, Times New Roman, Courier New, Trebuchet MS and Foundry's `CONFIG.fontDefinitions` plus the world's `core.fonts`; the output loads those definitions through `FontConfig.loadFont`. Each family gets a generic fallback. Sizes are 1–512 native pixels, weights are the strings `"400"`/`"600"`/`"700"`, alignment is left/center/right, and color accepts 3/4/6/8-digit hexadecimal values. Font files come only from Foundry's font configuration. A layer's width/height bounds its content; resizing changes its box, not its font size.

For custom layer types, the existing widget registry also resolves namespaced `overlay.layers[].type` values. Put extension options in a safe JSON `config` object and register the matching widget renderer. Unknown types and their configuration survive saves. The editor can manipulate their common geometry; it does not infer a custom inspector from `configSchema`. The registry's `defaults`, `render`, `update`, and `destroy` contracts apply to these layers too. Extend the type-specific inspector deliberately when adding new controls, without coupling the core layer model to Actor or Token documents. The built-in type names below are handled by the shared renderer rather than the extension registry.

The legacy `overlay.widgets` collection remains supported and rendered; it is separate from the Layers panel. New static layers and grouped character instances belong in `overlay.layers`.

## Character design components and grouped instances

`scripts/core/schema.js` exports `WIDGET_DEFINITIONS` metadata (`{type,label}`), `validateLayer`, `validateWidgetPreset`, `validateActorUuid`, `validateCharacterBinding`, and the shared `CHARACTER_FIELD_PATTERN`. Normalized field IDs begin with `character` and have one to five dot-separated segments, each starting with a letter and containing up to 48 letters/digits/underscores. Prototype-related segments are rejected. World Actor UUIDs use `Actor.<id>` with 1–64 letters/digits/underscores/hyphens; document-link parsing belongs to the data service before model validation.

Every design component has ordinary layer geometry, visibility, lock, name, ID, opacity, rotation, and `z` fields, plus:

| Type | Additional fields |
| --- | --- |
| `character-portrait` | `binding` (default `character.portrait`), `portraitSource` (`profile`/`token`), managed fallback `src`, `fit` (`cover`/`contain`), `circular`, `borderRadius` (0–3840), `lockAspectRatio` |
| `character-name` | `binding` (default `character.name`), `text` template (blank by default), `fallback`, existing text style fields |
| `dynamic-text` | `binding` (default `character.name`), `text` template, `fallback`, existing text style fields |
| `dynamic-number` | Numeric `binding` (default `character.hp.current`), `text` template (blank by default), `fallback`, existing text style fields |
| `resource-bar` | `binding` (current), `maxBinding` (maximum), `foregroundColor`, `backgroundColor`, `showValue`, `fallback`, existing text style fields |

Text styles remain flat fields: `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, and `shadow`. Text templates are limited to 10000 characters; fallback text to 1000. Bar colors use hexadecimal values. An unsupported field or non-finite numeric value produces a fallback; a bar requires a positive finite maximum. The renderer uses selected field values and plain text token replacement, never `eval` or HTML.

A grouped main-overlay layer has the following additional shape:

```json
{
  "id": "layer-character-a",
  "type": "character-widget",
  "name": "Character card",
  "x": 80,
  "y": 820,
  "width": 400,
  "height": 180,
  "rotation": 0,
  "opacity": 1,
  "visible": true,
  "locked": false,
  "z": 10,
  "presetId": "widget-basic-character-card",
  "actorUuid": "Actor.example",
  "actorUuids": ["Actor.example", "Actor.second"],
  "carousel": {
    "enabled": null, "mode": "combined", "traversal": null,
    "actorStartUuid": "Actor.example", "pageOrder": [], "startPageId": null,
    "duration": null, "pageDurations": {},
    "transition": null, "transitionDuration": null,
    "characterTransition": null, "characterTransitionDuration": null, "loop": null
  },
  "overrides": {
    "name": { "fontSize": 26, "color": "#ffffff" }
  }
}
```

`actorUuids` is an ordered list of at most 20 unique world Actor UUIDs. The legacy `actorUuid` remains the first-Actor compatibility alias and may be empty. If `actorUuids` is absent, validation derives the original single assignment from `actorUuid`; an explicit `actorUuids:[]` is authoritative and stays empty. Authors changing assignments must update the list, not only the alias. `carousel` contains bounded instance overrides; null scalar values inherit shared design defaults. Runtime indices, timers, Actor documents and data snapshots are stripped from saved configuration. See [Widget information pages](#widget-information-pages) below for the exact resolution contract.

`overrides` is keyed by component ID and supports only presentation keys: `opacity`, `visible`, `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, `shadow`, `fit`, `circular`, `borderRadius`, `foregroundColor`, `backgroundColor`, `showValue`, `animations`, and `triggers`. Geometry, templates, bindings, source images, Actor identities, and arbitrary documents are not component override fields. Unsupported keys are stripped; unsafe prototypes and invalid supported values throw. Component overrides are API/model support; a separate style-override inspector is not included. The instance's `animationOverrides` flag separately controls whole-widget inheritance.

`scripts/core/layers.js` exports `createLayer(type, canvas?)` for components and `createWidgetInstance(preset, options?)` for a new grouped instance. The latter validates the design, generates a fresh layer ID, forces the source `presetId`, and does not embed the design or Actor document. `duplicateLayer` isolates Actor bindings and override objects while retaining the shared preset reference.

The parent renderer resolves the shared design and prepares a scaled presentation for the selected Actor in the instance box, while the design itself remains unbound. Character changes prepare shared and page content off screen, then switch that coherent presentation; old and new Actor bindings never mix in one visible card. Preset saves update linked appearance without replacing instance bindings or positions. Hidden components in a mounted presentation stay available for declarative Show actions and character rules. Continuous playback is gated by visibility. Cleanup removes subscriptions and obsolete prepared scenes; asynchronous refresh results check their generation before painting.

## Widget preset store

`scripts/core/widget-presets.js` exports `WidgetPresetStore`, `registerWidgetSettings(onChange)`, `createWidgetPreset(name)`, `validateWidgetPreset`, `widgetPresetToOverlay(preset)`, and `overlayToWidgetPreset(overlay, {id,name}?)`. Conversion helpers reuse the established overlay editor/renderer; they reject nested grouped instances and legacy widget collections in reusable designs.

`modular-stream-overlay.widgetPresets` stores `{schemaVersion:4,revision,presets}` and accepts versions 1–3. Each design is `{schemaVersion:4,id,name,canvas,background,layers,animations,triggers,pages,cycling}`. It has no Actor assignment or `adapter` field. Existing `layers` remain shared elements; legacy designs normalize to empty `pages` and disabled automatic cycling without saving. Existing pages default to enabled. Initial default records have stable IDs `widget-basic-character-card` and `widget-compact-character-card`; they may be edited, renamed, duplicated, and deleted normally. Empty saved libraries remain empty rather than being reseeded.

| Method | Result |
| --- | --- |
| `getState()` | Isolated validated `{schemaVersion,revision,presets}`, synchronous |
| `list()` | Fresh validated design array, synchronous |
| `save(preset, options?)` | Inserted or replaced validated design |
| `create(name?, options?)` | Saved empty design with new stable ID |
| `rename(id, name, options?)` | Saved design |
| `duplicate(id, name?, options?)` | Saved independent design with a new ID |
| `delete(id, options?)` | Updated state |

Mutations are asynchronous, GM-only, serialized within the store instance, and accept `{expectedRevision}`. A stale revision throws `WidgetPresetConflictError`, code `WIDGET_PRESET_REVISION_CONFLICT`. Register settings once at `init`; its change callback receives `(validatedState, null)` or `(null, error)`. Use the module's configured `api.widgetPresets` instead of registering a second setting or store integration.

Design saves affect all linked instances. Full-overlay preset saves keep references to these designs, not embedded copies; portability therefore also requires the separate widget design library. Neither store contains Actor data snapshots. Configure additional selected fields through adapters/mappings, not by adding document properties to saved instances.

## Widget information pages

`preset.layers` contains shared components that remain in place across information-page changes for the same Actor. A page is `{id,name,enabled:true,duration:null|milliseconds,skipIfUnavailable:boolean,layers:[]}`. All page layers use the existing validated component shape, local canvas geometry, animations, triggers, and normalized bindings. A preset may contain at most 20 pages and 100 components across shared elements plus all pages. Component IDs must be unique across that entire design; page IDs are unique among pages. Pages cannot nest pages, legacy widget collections, or grouped character-widget instances. Duplication creates fresh page/component IDs and remaps internal trigger targets, retaining references to shared targets.

`preset.cycling` defaults to:

```js
{ enabled: false, mode: "information", traversal: "pages-first",
  duration: 5000, transition: "fade", transitionDuration: 400,
  characterTransition: "fade", characterTransitionDuration: 500,
  loop: true, startPageId: null }
```

Durations are integer milliseconds: default/per-page dwell 100–3600000, page/character transition duration 0–10000. A null page duration inherits the default. Both transition slots accept `fade`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `scale`, and `instant`; `startPageId` is null or an existing design page. Conversion helpers preserve pages and cycling settings. Active Actor/page indices, remaining time, pause state, timers and frames are runtime state and are never saved.

`scripts/carousel/schema.js` exports `PAGE_TRANSITIONS` (`{id,label}` metadata), `PAGE_LIMIT=20`, `ACTOR_LIMIT=20`, `COMPONENT_LIMIT=100`, frozen string arrays `CAROUSEL_MODES` and `CAROUSEL_TRAVERSALS`, `validatePages(input,{canvas,normalizeLayer,sharedLayers})`, `validateCycling(settings,pages)`, `validateCarousel(input,options)`, `validateActorUuids(input)`, `validateInstanceCarousel(input,{actors}?)`, and `resolveCarouselSettings(instance,preset)`. The core injects its existing layer validator to avoid circular imports. Draft-only helpers `createPage`, `addPage`, `duplicatePage`, `renamePage`, `deletePage`, and `reorderPage(draft,id,action)` retain their established signatures; reorder actions are `up`, `down`, `first`, and `last`. They and the resolution helper/mode metadata are re-exported by `scripts/core/widget-presets.js`. These helpers never save settings or write Actors.

Instance `carousel` accepts `enabled`, `mode`, `traversal`, `actorStartUuid`, `startPageId`, `duration`, `transition`, `transitionDuration`, `characterTransition`, `characterTransitionDuration`, and `loop` as nullable scalar overrides. It also accepts `pageOrder:[]` and `pageDurations:{pageId:milliseconds}`. `actorStartUuid` must be assigned. Partial page order appends remaining enabled pages; removed-page references are ignored when resolving. Per-instance page duration wins over design page duration, then the default duration. Invalid known values throw; unknown runtime/document fields are stripped.

`resolveCarouselSettings(instance,preset)` returns `{actors,pages,settings}` without modifying its inputs. Actors are UUID strings. Pages are isolated enabled page records in effective order, with per-page overrides applied. Settings contain inherited/overridden cycling values plus the resolved `actorStartUuid`, available `startPageId`, effective `pageOrder`, and known `pageDurations`. Explicit static mode forces `enabled:false`. The renderer, sequence preview, and live controls share this contract. An empty assignment stays empty. If a legacy design has no explicit pages, rendering may use a runtime-only `shared-content` page; all-disabled explicit pages remain empty.

`scripts/carousel/sequence.js` exports `buildCarouselSequence` and `UnifiedCarouselController`, coordinating both dimensions through the existing `CarouselController` in `scripts/carousel/runtime.js`. Default `pages-first` traversal is A/P1 → A/P2 → B/P1 → B/P2; `characters-first` reverses the nesting. `information` restricts to one Actor, `character` restricts to one page, `combined` traverses all eligible pairs, and `static` holds one pair without automatic resume. One underlying scheduler owns at most one advancement timeout; there is no separate Actor timer. Eligibility is bounded by 20 Actors × 20 pages.

`scripts/render/actor-carousel.js` prepares complete Actor presentations using the existing page renderer and animation engine. Shared artwork and page fields bind to the same Actor before display. At most two prepared Actor presentations are cached, while off-screen assignments retain only bounded selected normalized scalar values. Live updates refresh authorized data without rebuilding the sequence or resetting dwell. Cleanup cancels preparation, transitions and subscriptions. Hidden widgets suspend scheduling; reduced motion and animation disable preserve sequencing with immediate transitions.

The local unified controller exposes `getState()`, `start()`, `pause()`, `resume()`, `select(pageId,actorUuid?)`, `selectActor(actorUuid)`, `next()`, `previous()`, `reset()`, `refreshAvailability()`, `setVisible(boolean)`, and `destroy()`. State includes `activeActorUuid`, `activePageId`, Actor/page/sequence indices, the available sequence, `availableActorUuids`, `availablePageIds`, `paused`, `running`, `visible`, `transitioning`, `ended`, `remaining` and `destroyed`. Renderer facades expose this local navigation for preview. `context.onCarouselChange(state)` reports local changes; it does not infer remote OBS state. Use the GM API below for commands to saved output.

Pause preserves remaining dwell; Resume continues it and can temporarily run a non-static carousel whose saved `enabled` is false. Manual selection/navigation and Reset preserve pause state and start a full selected dwell. Dwell starts after preparation and transition, so their time is added to display duration. An Actor boundary uses only the configured character transition, including when its page changes too. Non-looping sequences hold the final pair. Reload selects the configured available starting pair or first eligible fallback; only saved automatic behavior resumes. Unavailable Actors and disabled pages are omitted; optional page skipping evaluates selected dynamic values for each Actor. No eligible pairs means idle with no timer or infinite skip. See [CAROUSEL.md](CAROUSEL.md#timing-and-reload-policy) for edge cases and live checks.

## System adapters

The built-ins are generic identity, CAIN 1.3.26 and D&D5e 5.3.3 PC. See [CAIN.md](CAIN.md), [DND5E.md](DND5E.md) and the [acceptance report](internal/PHASE6_ACCEPTANCE_RU.md) for schema targets and runtime limits. System paths belong in adapters, not in presets, UI or renderer. External adapters remain trusted JavaScript, not sandboxed expressions.

```js
Hooks.once("modularStreamOverlayInit", api => {
  api.registerAdapter({
    id: "my-module:focus", label: "My system focus", systemId: "my-system",
    interfaceVersion: 1, actorTypes: ["character"], testedSystemVersions: ["2.0.0"],
    fields: [
      { id: "character.focus.current", label: "Focus", type: "number", group: "Resources",
        maxField: "character.focus.max", role: "current", actorTypes: ["character"], testedSystemVersions: ["2.0.0"] },
      { id: "character.focus.max", label: "Maximum focus", type: "number", group: "Resources",
        role: "maximum", actorTypes: ["character"], testedSystemVersions: ["2.0.0"] }
    ],
    resources: [{ id: "focus", label: "Focus", currentField: "character.focus.current",
      maxField: "character.focus.max", polarity: "lower-is-worse" }],
    normalize(actor, { user, fields = [], systemVersion } = {}) {
      if (!actor?.testUserPermission(user, "OBSERVER") || actor.type !== "character" || systemVersion !== "2.0.0") return null;
      const values = {};
      for (const id of fields) {
        const value = id === "character.focus.current" ? actor.system.focus?.value
          : id === "character.focus.max" ? actor.system.focus?.max : undefined;
        if (id === "character.focus.current" || id === "character.focus.max") values[id] =
          typeof value === "number" && Number.isFinite(value) ? value : null;
      }
      return values;
    }
  });
});
```

`id`, `label` and `normalize` remain required; `systemId` is optional. Older registrations without metadata remain v1. Registrations without fields do not automatically supply dynamic component fields. The only supported explicit `interfaceVersion` is 1. Optional `actorTypes` and `testedSystemVersions` are arrays of 1–32 unique supported strings. Adapter-level tested versions are descriptive: **strict version checks belong on field descriptors**. Field actorTypes overrides the adapter default; this lets CAIN retain legacy field applicability while restricting new native fields.

An adapter may name `accentField`, a text field holding the character's own color (`#rrggbb`), and `accentKeyField`, the text field whose values character color rules use by default (CAIN: the blasphemy's color and name). A character's color resolves as its profile accent, then the world's color rule for the `accentKeyField` (or GM-chosen field) value, then `accentField`.

Field descriptors require unique normalized `id`, printable `label`, and `type: string|number|image`. Optional `group`, `unit` and `role` are printable strings up to80 characters. `format: integer|decimal|percent` remains descriptive metadata, not a new renderer formatter. `maxField` must refer to a numeric field; existing targets are checked at registration. A legacy cross-catalog target may be supplied by a mapping; unresolved targets are validated against the complete selected catalog before reads. A scope/provider change that removes a maximum marks only the affected descriptor unavailable (invalidMaximum:true) and removes its suggested maxField; generic identity and unrelated fields remain available. Malformed saved mappings are ignored with a warning while adapter fields remain usable. Resources are bounded to64 records `{id,label,currentField,maxField,polarity}`; both referenced fields must exist as numeric descriptors in the adapter. Polarity is `lower-is-worse`, `higher-is-worse` or `neutral`. IDs and fields are limited to128 entries per adapter; the request limit remains128. Stored resources remain separate scalar values, not nested resource objects.

Auto selection retains generic identity plus the **first registered** adapter whose systemId matches `game.system.id`. Multiple candidates produce a warning. **Widget Preset Manager → Data provider** stores an explicit choice in the new world setting `adapterPreferences`, shaped `{systemId:adapterId}`. `api.getAdapterPreferences()` returns a validated copy; `api.setAdapterPreferences(map)` is GM-only. Remove a system key to restore Auto. A missing/incompatible explicit provider or invalid preferences yields generic identity and a warning, suppressing system mappings until the choice is corrected. An ordinary unknown system without such an error can still use safe mappings. Providers are not composed. Saved `overlay.adapter.id/config` remains reserved and does not silently select this service's provider.

The generic adapter owns name, portrait, prototype-token artwork, UUID and Actor type. System adapters cannot shadow these five identity IDs. `generic.normalize` also retains its earlier explicit `name`/`portrait` legacy request contract. System normalizers receive `{user,fields,portraitSource,systemVersion}` and return only flat scalars. Never call rolls, migration, sheet preparation or document updates to obtain values; use prepared data. Do not return full documents, private notes, HTML payloads or system snapshots. The service filters extra returned fields and sanitizes numeric/image/text types.

### Character-data service

- `getAdapterState()` returns `{systemId,systemVersion,adapterId,explicit,candidateIds,warning}`.
- `fieldDefinitions({dataSource:"actors",actorType}?)` returns descriptors with `providerId` and metadata `status`; legacy unscoped mappings have `legacyGlobal:true`. `actorType` is optional; version checks apply even without an Actor. Metadata status does not certify viewer permission or a concrete value. The explicit demo source keeps its existing synthetic metadata contract.
- `resourceDefinitions({actorType}?)` returns validated resource pairs plus providerId/status. It does not read Actor values.
- `listActors()` returns permitted persistent world Actor summaries. Compendiums, unlinked Token Actors and external URLs remain unsupported.
- `resolve(reference,fields,{portraitSource}?)` returns `{values,warning,status,fieldStatus}`. Existing callers can continue reading values/warning. Only requested known IDs enter values. Unknown IDs are absent and have unsupported-field status; known unavailable IDs are null. Field statuses are available, unsupported-field, unsupported-actor-type, unverified-version, unavailable. Missing and invalid legacy scalar reasons may both be unavailable. Mixed overall statuses become unavailable. The separate synthetic demo source retains its prior result shape.
- `resolveActor(reference)` resolves a viewer-permitted Actor for assignment; do not persist or pass that Document into the renderer. GM previews use the configured OBS Player. Permission and viewer identity are rechecked after async reads.
- `previewMappings(reference,input)` validates unsaved mappings and performs an isolated read using the same viewer/system/provider context. It changes no settings, subscriptions or live mappings.
- `subscribe(reference,callback)` returns an unsubscribe function. Resolve fresh selected values from callbacks; do not retain Document snapshots. `refresh()` invalidates subscribers after mappings/provider/viewer changes without altering saved overlays.

Invalid provider/mapping errors and adapter exceptions produce bounded diagnostic messages without dumping Actor data or exception payloads. Available empty strings and zero numbers remain valid scalars. HP percentage retains internal current/max dependencies and mapping precedence: generic → system provider → explicit mapping → derived percent, unless percent itself has an explicit applicable mapping.

An optional synchronous `affectsChange(event,{actor,document,changes}) → boolean` can identify dependencies on world Items/ActiveEffects for subscribed permitted Actors. Events are limited to the service's public create/update/delete Actor, Item, ActiveEffect and linked Token hooks. No arbitrary hook names or per-widget watchers are registered. Base Actor/embedded document events always invalidate generic identity too, so returning false cannot suppress those. A thrown/non-boolean/async result makes the provider's fields unavailable until a successful later invalidation; generic identity remains. Clean-up removes every hook/timer/subscriber. This callback is trusted code; arbitrary JavaScript extensions are not a security sandbox.

### Advanced field mappings

`fieldMappings` remains an array of at most64 `{id,label,type,path}` records; optional `systemId`, `actorTypes`, `testedSystemVersions` and numeric `maxField` add scope/resource pairing. IDs stay normalized; identity replacements, private/flags/prototype/biography paths, expressions and document traversal are rejected. Only finite number or bounded string values are read through own-property traversal of a restricted `system.*` path. Syntactic validation alone does not prove that an arbitrary custom field is suitable for broadcast; choose documented public data deliberately.

Older mappings with no scope remain global, unchanged, and are identified in metadata/UI. There is no automatic scope migration or path rewriting. Applicable explicit mappings override built-in values; an inactive scoped override leaves the applicable built-in definition intact. A newly declared inactive custom field remains null with its applicability status. The JSON dialog can preview unsaved input under viewer permissions without changing live data; editing the input invalidates a pending preview. Save is still an explicit GM setting write. No arbitrary JavaScript evaluator or full Actor field enumeration is introduced.
## Store and versioning

All reads return isolated validated data. Mutations are async, GM-only, serialize within the store instance, and increment the global state revision. Pass a captured `expectedRevision` to detect an already stale editor; conflicts throw `OverlayConflictError` with code `OVERLAY_REVISION_CONFLICT`. This is not a server-side atomic lock across simultaneously writing GM browsers.

| Operation | Result |
| --- | --- |
| `getState()` | Current validated state, synchronous |
| `createOverlay(name, options?)` | Saved new overlay |
| `saveOverlay(overlay, options?)` | Saved overlay, inserted or updated |
| `renameOverlay(id, name, options?)` | Saved overlay |
| `deleteOverlay(id, options?)` | State; deleting active clears the selection |
| `setActive(idOrNull, options?)` | State; null means transparent output |
| `listPresets()` | Fresh built-in and custom copies, synchronous |
| `savePreset(overlay, name?, options?)` | New custom preset |
| `loadPreset(id, targetOverlayId = null, options?)` | Saved overlay, preserving existing target ID/name |
| `renamePreset(id, name, options?)` | Custom preset |
| `duplicatePreset(id, name?, options?)` | New custom preset, including copies of built-ins |
| `deletePreset(id, options?)` | State; rejects built-ins |

An `options` object may contain `{expectedRevision}`. First-overlay creation activates it; an explicit null selection is preserved when other saved overlays exist.

World setting `modular-stream-overlay.state` has this shape:

```json
{
  "schemaVersion": 6,
  "revision": 0,
  "activeOverlayId": null,
  "overlays": [],
  "presets": []
}
```

Overlay shape:

```json
{
  "schemaVersion": 6,
  "id": "overlay-example",
  "name": "Main overlay",
  "canvas": { "width": 1920, "height": 1080 },
  "background": { "src": "", "opacity": 1, "fit": "cover" },
  "layers": [],
  "widgets": [],
  "adapter": { "id": "generic", "config": {} },
  "pages": [],
  "cycling": { "enabled": false, "mode": "information", "traversal": "pages-first", "duration": 5000, "transition": "fade", "transitionDuration": 400, "characterTransition": "fade", "characterTransitionDuration": 500, "loop": true, "startPageId": null }
}
```

Full-overlay preset shape is `{schemaVersion:6,id,name,overlay}`. Presets include the complete canvas, background, layers, text/image properties, stack order, grouped widget preset references, ordered Actor UUIDs, instance carousel overrides, animation/rule settings, style overrides, and any root page configuration. Built-in full-overlay examples are frozen code templates and are listed with `builtin:true`; persisted custom entries cannot use reserved `builtin-` IDs. The separate `viewerUserId` setting is intentionally absent from presets. Reusable widget designs use the separate [Widget preset store](#widget-preset-store).

Schema 6 accepts schema-1 through schema-5 state, overlays, and presets. Reads normalize isolated copies to schema 6 without writing settings. Missing legacy layers become an empty list; existing IDs, references, geometry, configuration, and stack order remain. New common fields default to rotation 0 and unlocked. Legacy images default to an unlocked aspect ratio to preserve their existing geometry. Missing animations become null slots, a zero-duration transition, and no triggers. Missing pages become an empty list with automatic cycling disabled; existing pages become enabled. Legacy `actorUuid` supplies one assignment only when an explicit list is absent. An explicit mutation writes validated schema-6 state; opening an editor or rendering OBS never rewrites the world setting.

There may be up to 100 overlays, 100 custom presets, and 100 layers/widgets per overlay, with a 2 MB total configuration bound. Canvas dimensions are whole numbers from 64 to 7680. Layer dimensions are 1–7680, x/y are −32768–32768, rotation is −360–360 degrees, opacity is 0–1, and integer stack order is −10000–10000. Text is limited to 10000 characters. JSON depth/size have explicit limits. Extension configuration may contain only JSON values with safe keys and is limited to 64 KiB per instance. Core fields are allowlisted; extensions should store options only in `config`. Unsafe image schemes, embedded images, absolute paths, and path traversal are rejected.

Unsupported schema versions throw a visible error and are never reset to defaults or overwritten automatically. Later schema changes must add explicit migration support before raising `SCHEMA_VERSION`; support for schema 1 does not imply unknown future schemas can be read safely.

## Animations and triggers

`scripts/animation/schema.js` exports `ANIMATION_DEFINITIONS`, `EASINGS`, `TRIGGER_EVENTS`, `CONDITION_OPERATORS`, `ACTION_TYPES`, `validateAnimationConfig`, `validateAnimationSettings`, `validateTriggerRules`, and `createAnimationExamples`. These validators return isolated declarative data. Unknown safe type/event/action IDs survive saves for extensions; absent registrations are inert. The visual inspector lists built-in registrations and preserves saved unknown IDs; it does not generate new inspector entries from runtime registry extensions.

Layers, overlay roots, and reusable widget designs accept:

```js
{
  animations: {
    entrance: { type: "fade-in", duration: 500, delay: 0, easing: "ease-out",
      direction: "normal", intensity: 1, repeat: 1 },
    exit: null,
    emphasis: { type: "color-flash", duration: 400, color: "#ff4444" },
    transition: { duration: 450, easing: "ease-out", bar: true,
      numeric: false, color: false, opacity: false }
  },
  triggers: [{
    id: "damage", name: "Damage flash", enabled: true,
    event: "decreased", field: "character.hp.current", condition: null,
    action: { type: "color-flash", target: "portrait",
      animation: { type: "color-flash", duration: 400, color: "#ff4444" } },
    continuous: false
  }]
}
```

Entrance types are `fade-in`, `slide-in-left/right/top/bottom`, `scale-in`, and `pop-in`; exit types are `fade-out`, `slide-out-left/right/top/bottom`, and `scale-out`. Emphasis types are `pulse`, `flash`, `shake`, `bounce`, `glow`, `color-flash`, and `scale-pulse`. Slashes here enumerate separate IDs. Glow/color-flash use temporary filter highlights. Duration is 1–10000 ms, delay 0–10000 ms, intensity 0–2, repeat an integer 1–20; delay plus duration times repeat cannot exceed 60000 ms. Directions are `normal`, `reverse`, and `alternate`. Easing is `linear`, `ease-in`, `ease-out`, or `ease-in-out`; colors are hexadecimal. Transition duration allows zero for immediate behavior. Numeric interpolation is optional.

Each element permits at most 32 rules, together bounded to 64 KiB. Events are `visible`, `hidden`, `field-changed`, `increased`, `decreased`, `crossed-above`, `crossed-below`, and `manual`. Data events require a normalized `character.*` field. Conditions are null or `{operator,value,field?}`. Operators are `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `increased`, `decreased`, `crossed-above`, and `crossed-below`. An omitted condition field uses the event field; numeric operators require finite numbers. Crossings compare valid previous/current values, including equality on the previous side. Missing values do not match. There are no executable expressions or arbitrary system paths.

Actions are `{type,target,animation?}` with `play-animation`, `show`, `hide`, `glow`, `color-flash`, or `animate-number`. `self` targets the source. Whole-widget rules target their own component IDs; component rules target siblings within that composition; ordinary layer rules can target siblings on that overlay. Targets do not escape one widget into another instance. To expose a component reaction in Live Controls, author a whole-widget manual rule targeting that component. Component-only manual rules have local preview but are not separate Live Controls rows.

`continuous:true` requires a data event, a condition, and `play-animation`, `glow`, or `color-flash`. One owned browser effect repeats only while current values and visibility permit it. Continuous crossing conditions become current-level tests during reconstruction. Other repeats remain bounded. New emphasis replaces its channel, continuous effects own source/rule-specific channels, and visibility has its own channel. Removal, reset, disable, and reduced-motion updates release effects and settle numeric values; no queue of animation frames is persisted.

A grouped instance defaults to `animationOverrides:false`, inheriting the shared design's complete top-level settings/rules. Setting it true selects the instance's complete configuration, including null slots or empty rules that deliberately disable inherited effects. A zero component transition duration inherits the positive grouped-widget duration. Shared edits preserve Actor assignments and geometry.

### Trusted registrations

Register on the public module init hook in every client:

```js
Hooks.once("modularStreamOverlayInit", api => {
  api.animations.registerType({
    id: "my-module:soft-tilt", label: "Soft tilt", category: "emphasis",
    keyframes: ({ intensity }) => [
      { transform: "none" }, { transform: `rotate(${intensity * 2}deg)` },
      { transform: "none" }
    ]
  });
  api.animations.registerEvent("my-module:focus-changed", (rule, { previous, current }) =>
    current[rule.field] !== previous[rule.field]);
  api.animations.registerAction("my-module:accent", ({ target }) =>
    target.controller.play({ type: "glow", duration: 400, color: "#88ccff" }));
});
```

`registerType` accepts unique `{id,label?,category?,keyframes(config)}`; frames must be an array. The controller composes frames with current inline rotation/scale, opacity, and filter and never commits them to the design. `registerEvent(id,predicate)` adds a data-update predicate; saved rules contain its name only. `registerAction(id,handler)` calls trusted code with `{target,source,rule,event}`. The event contains only selected normalized scalar snapshots, previous/current values, and semantic metadata. Registered modules remain trusted Foundry code and must clean up resources they create. Built-in/duplicate registrations cannot be replaced.

### Live commands and synchronization

`api.liveControls.getState()` returns `{overlays:[{id,name}],activeOverlayId,layers}`, with effective shared motion and carousel metadata resolved on grouped layers. GM-only methods are `setActive(idOrNull)`, `setVisibility(layerId,boolean)`, `play(layerId,{animation?}?)`, `play(layerId,{ruleId})`, `reset(layerId)`, and `carousel(layerId,action,pageId?,actorUuid?)`. Carousel actions are `select`, `select-actor`, `next`, `previous`, `pause`, `resume`, and `reset`. `select` requires a page ID and may select an assigned Actor; `select-actor` requires the Actor UUID. `api.animations.dispatch(layerId,eventType)` sends a named event with no Actor values. Methods address the saved active overlay. Live Show/Hide persists `layer.visible`; automatic trigger visibility and carousel navigation remain temporary. Live selectors choose command targets and do not report the remote instance's current Actor/page or pause status.

Character-data rules run in each rendering context through the existing permission-aware `CharacterDataService` and authenticated Foundry document updates. The initial read establishes a baseline and restores only eligible continuous effects. Reload does not replay historical damage, healing, or expired commands. Authored entrance animations run once after the visible outer scene is mounted; prepared hidden Actor presentations do not replay grouped entrances.

Manual effects use the public module socket namespace `module.modular-stream-overlay`. Foundry's native `/stream` view initializes database listeners but omits the core `User.query` receiver, so GM-to-stream queries cannot deliver these commands. The module manifest enables its own socket and registers only its own listener, without activating game-only listeners or duplicating database listeners.

Installed v14.368 relays module events with the authenticated sending User ID as a separate second callback argument. The transport resolves that User and requires GM authority for commands; it never trusts a sender field inside the payload. Acknowledgements require the configured Player's server-supplied identity and a matching pending command ID. Missing sender identity fails closed. Targeting uses recipient User IDs, while normal game tabs ignore stream commands. With multiple OBS sessions, success wins over a stale session's rejection. Delivery is bounded in memory and time, cleared on disconnect/close, and never persisted or retried. Extensions should call the existing `liveControls` or `animations.dispatch` APIs rather than sending transport packets.

Commands contain IDs, active overlay/layer IDs, kind, timestamps, and optional bounded animation/rule/event identifiers. They have a 10-second lifetime, reject invalid/future/expired metadata, and retain only a bounded 256-ID deduplication cache. The sender waits at most 6 seconds for acknowledgment, does not retry, and reports unavailable viewers. No raw documents, expressions, frame snapshots, offline queue, or durable event log travel through this channel. Authentication comes from Foundry's separate callback argument, never a payload `userId`. Actual Foundry/OBS delivery and visual acceptance still require the checks in [PHASE5.md](internal/PHASE5.md#manual-acceptance).

### Editable demonstration and diagnostics (0.5.4)

`api.installDemo({reset:false})` is GM-only and returns `{overlayId,presetId,created,...}`. It creates ordinary saved overlay/preset records with fixed demo IDs, leaves the active overlay unchanged, and preserves existing demo edits unless the caller explicitly passes `reset:true`. The editor provides confirmation for reset. This never runs automatically on startup.

Character-widget instances now normalize `dataSource` to `"actors"` (the compatible default) or `"demo"`. Actor mode accepts only world Actor UUIDs. Demo mode accepts only `Demo.warrior` / `Demo.mage`; their scalar values are held in memory by `CharacterDataService`, with no documents created. Presets remain free of assignments. `fieldDefinitions()` continues to describe the actual adapter; `fieldDefinitions({dataSource:"demo"})` explicitly describes the simulated source. `simulateDemo(reference,"damage"|"healing")` updates synthetic subscriptions only.

`api.liveControls.testCommand(layerId,options)` uses the same GM-only authenticated saved-target validation as other controls. Additional kinds are `entrance`, `exit`, and `demo` (`action:"damage"|"healing"`, restricted to demo instances). Carousel actions also include `next-page`, `previous-page`, `next-actor`, `previous-actor`; these preserve pause state and change only the requested axis. Editor previews call the same renderer dispatcher with the current overlay ID, without publishing drafts.

`api.getDebug()`, GM-only `api.setDebug(boolean)`, and `api.getDiagnostics()` expose optional diagnostics. The `debugAnimations` world setting defaults to false. Renderer diagnostics contain identifiers, mode/page/pause/timing metadata, last trigger/animation, missing field IDs, and resolution failure flags. A bounded `playback` list adds requested/started/sample/finished/cancelled/skipped phases, DOM descriptors, connectivity, duration, computed opacity/transform, and reasons such as reduced-motion or render-interrupted. No Actor values or documents are returned. `getDiagnostics()` is available only to a GM or the configured Player output; editor controls clearly identify their local preview snapshot. Each debug playback takes one midpoint style sample; there is no frame logger. Whole-widget play/preview uses the outer geometry surface so scale effects are not clipped by the active Actor's fitted stage. Actor-dependent trigger evaluation still belongs to that Actor's runtime.
