# Modular Stream Overlay

The configuration interface supports English and Russian. In Foundry's module settings, **Interface Language / Язык интерфейса** offers Auto (follow Foundry), English, or Русский for each client. Switching updates open module windows without reloading or changing stream content. See [localization notes](docs/LOCALIZATION.md) for adding translations.

A Foundry VTT **v14** module for transparent OBS overlays. Version **0.6.0** adds native CAIN 1.3.26 character fields, opt-in CAIN example designs, a D&D5e 5.3.3 PC adapter, grouped field discovery, provider selection and scoped mapping previews. Existing presets, bindings, animations and combined character/page cycling remain compatible. There are no runtime dependencies or build step. See [CAIN.md](docs/CAIN.md), [DND5E.md](docs/DND5E.md), and the [Phase 6 acceptance report](docs/PHASE6_ACCEPTANCE_RU.md) for supported schema targets and runtime verification limits.

For agent-authored layouts, start with [AGENTS.md](AGENTS.md) and the [overlay authoring toolkit](docs/OVERLAY_AUTHORING.md). `tools/overlay-author.mjs` generates schema-validated bundles and optional GM import macros from the three JSON templates in `examples/authoring/`, without editing module internals or databases.

## Existing installation and development

The canonical source on this computer is `C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay`, confirmed against Foundry's configured `dataPath`. Edit the installed folder directly; the earlier copy under this chat's outputs is package/staging material. Do not copy whole folders over it: the installed module contains a user background image that must be preserved.

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for the confirmed paths, direct-edit workflow, and an explicit selective deployment/watch fallback when a development environment must keep source elsewhere. Phase 5 changes are made directly in the installed folder. Existing image files are preserved. Overlay schemas 1–5 normalize in memory to schema 6; widget design schemas 1–3 normalize to schema 4. Older designs retain their shared components with no pages and cycling disabled; legacy single-Actor bindings remain supported. Migration persists only on an explicit save or other settings mutation. Restart Foundry after manifest changes and refresh the GM client and OBS source once to load updated code.

## Use the existing installation

The supplied Foundry user-data path is `C:\Users\Lev\AppData\Local\FoundryVTT`.

1. The module is already installed at `C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay`; do not replace the folder or its uploaded assets with an older staging copy.
2. Restart Foundry after updating, then refresh open clients and the OBS Browser Source once. The restart enables the module's command socket on the server when upgrading from versions before 0.5.3.
3. Open your world, choose **Game Settings → Manage Modules**, and enable **Modular Stream Overlay**.
4. Open **Game Settings → Configure Settings → Module Settings → Modular Stream Overlay → Open Overlay Editor**. An **Open Overlay Editor** button is also added to the Game Settings sidebar. A GM can alternatively run `game.modules.get("modular-stream-overlay").api.openEditor()` in a script macro.

The other installed overlay modules are separate packages. This module does not migrate or modify their settings. For the first runtime test, disable other modules that customize Foundry's stream page to avoid conflicting output.

## Create and edit an overlay

- Click **Create first overlay** or **+**. The first overlay becomes active automatically. Defaults are 1920 × 1080 and a transparent background.
- Click **Upload Background** to choose a PNG, JPEG, or WebP from your computer. A progress message appears while the file is validated and uploaded; successful uploads select the image in the current draft, update its thumbnail, and refresh the live preview. Click **Save overlay** to persist the selection and publish it to OBS. Uploading does not silently publish an unsaved overlay.
- Use **Browse Existing** to open Foundry's supported FilePicker, or **Remove Background** to clear the draft. The thumbnail and current asset path identify the selected image. Existing manually entered asset paths still work. Local relative references such as `assets/frame.webp` are saved; image data is never embedded. Static image/background paths exclude remote URLs and operating-system paths. Actor portrait artwork may also use a credential-free HTTP(S) URL already configured on the Actor.
- Choose **Cover**, **Contain**, or **Stretch**, and adjust opacity. The checkerboard preview updates immediately; the checkerboard is never sent to OBS.
- Change width and height (whole numbers from 64 to 7680 pixels), rename, or remove the background. Click **Save overlay** to persist and publish these draft changes.
- The sidebar selects which configuration you edit. **Active on stream** separately selects which saved configuration OBS displays. Choosing **None — transparent** clears output. Saving another overlay does not undo that selection. Deleting the active overlay clears output too.
- Reopening the editor or reloading Foundry loads the saved configuration. World settings persist in Foundry's normal world database.

Unsaved drafts are local to the editor. Closing or changing the selected overlay asks before discarding edits. If another editor changes saved settings, your draft is preserved and saving it is blocked until you reload. Use one GM editor at a time: Foundry's world-setting API does not provide an atomic compare-and-swap operation for truly simultaneous writers.

### Visual layer editing

The editor places tools beside the canvas and keeps Layers and Properties alongside it. The background remains a separate canvas-wide image behind every layer.

1. Use **Add Image** or **Add Text** to create a layer. For images, use the existing upload or Browse Existing workflow in the selected layer's properties. Uploads use the same persistent storage and validation as background images.
2. Click a layer on the canvas or in the Layers panel. Drag its body to move it; drag a selection handle to resize it. Canvas fit and zoom change only the view: positions and sizes are always stored in the overlay's native pixels. Image aspect-ratio locking preserves its current box proportions during resizing.
3. Edit the selected layer's name, position, size, rotation, opacity, visibility, and lock state in Properties. Image layers provide Contain, Cover, and Stretch; text layers provide content, a bundled list of common local fonts with a generic fallback, size, weight, color, alignment, and optional shadow. Text is displayed as text, including literal HTML-like characters.
4. Use the Layers panel to select, show/hide, lock/unlock, duplicate, delete, or reorder layers. Higher layers cover lower layers. Locked layers cannot be dragged, resized, or nudged. Hidden layers remain editable through the layer list and do not appear in OBS.
5. With the editor focused and outside editable controls, use arrow keys to move the selected layer by 1 native pixel, Shift+arrow by 10 pixels, Delete/Backspace to delete, and Ctrl/Cmd+D to duplicate. Text fields, number inputs, selections, and other editable controls keep their normal shortcuts.
6. Click **Save overlay** to publish the layout. Preview selection borders, handles, layer controls, and checkerboard never appear in OBS. Unsaved changes remain local; **Reload saved** restores the saved composition after confirmation when needed.

Rotation is entered numerically. Resize handles follow the layer's rotation. Missing image files are hidden without removing other content. Text clips to its layer box; enlarge the box when more content should be visible. There are no external font downloads; font availability can vary between the GM's computer and OBS, so choose a font installed on both for matching metrics.

### Reusable character widgets

1. Configure the dedicated OBS viewer below and give that user **Observer** access to the world Actors you want to show. The GM preview uses the viewer's permissions too.
2. Open **Widget Preset Manager** from the overlay editor or the module settings. Start with **Basic Character Card**, **Compact Character Card**, or **Create widget preset**. Both examples are ordinary editable presets that you may rename, duplicate, or delete.
3. Choose **Edit / preview**. Set the local design dimensions, then add images, text, color backgrounds, character portraits/names, dynamic text/numbers, and resource bars. The designer reuses the same drag, resize, layer, styling, and keyboard controls as the overlay editor. Choose **Preview with character** for temporary live preview data; that character is never saved into the design.
4. Select a dynamic component and choose an available **Character field**. Text can combine literal words with tokens such as `HP: {character.hp.current}/{character.hp.max}`. Fields come from the active adapter; unsupported values use safe fallbacks. Save with **Save widget design**.
5. In an overlay, use **Add widget → choose preset → assign character**. The searchable picker shows permitted Actors and their portraits. You can also paste `Actor.…` or `@UUID[Actor.…]{Name}`, or drag an Actor from Foundry's Actor Directory onto a widget or its properties.
6. Move or resize the resulting card as one layer. Duplicate it and use **Assign / change character** to link another Actor. Click **Save overlay** to publish the instance and its binding. **Edit shared design** changes the common appearance of linked instances while retaining each instance's Actor and placement.

Layers can carry borders, rounded corners, drop shadows, line height, highlighted labels, `**bold**` template markup, empty-value captions and value labels; circle indicators accept a fixed count and exact size/spacing. **Character profiles** (accent color, full name, full-body art per Actor) are shared by all widgets showing that character. See [OVERLAY_AUTHORING.md](docs/OVERLAY_AUTHORING.md#optional-presentation-fields).

Generic fields cover names, profile/token artwork, UUIDs and Actor types. CAIN 1.3.26 adds 56 scalar fields, including CAT, prepared Psyche, Bursts, Stress, Injuries, Divine Agony, Sin Overflow, Kit Points, progression and ten skills; old health/power/level bindings retain their meaning. D&D5e 5.3.3 supports 28 PC fields including effective HP maximum, AC, prepared level, abilities and three resource slots. Other systems retain generic fields and may add mappings or external adapters. New system-specific fields are available on patch releases of their tested major.minor line (for example CAIN 1.3.x, D&D5e 5.3.x) and unavailable on other lines or pre-release builds. Schema/fixture targets do not by themselves certify a live Foundry or OBS run; consult the acceptance report.

Saved widget references contain a preset ID and ordered Actor UUID assignments, never an Actor document snapshot. Actor updates refresh subscribed character components through Foundry's authenticated document updates. Opening OBS resolves current values immediately; normal live updates do not require an OBS refresh. Live Foundry/OBS behavior still requires runtime acceptance.

### Coordinated character and information cycling

1. Open a widget design. In **Edit content**, keep the portrait, name, and frame in **Shared elements — visible on every page**. Choose **Add page** for each changing information panel, then select that page to add or edit its components on the canvas. Use **Rename page**, **Duplicate page**, **Earlier**, **Later**, and **Delete page** to manage the sequence. Put all components in pages when the whole card should change.
2. In **Cycling settings**, choose the preset's default mode and enable automatic cycling. Set the default and optional per-page duration, page transition, independent character transition, looping, and starting page. Defaults are 5 seconds of dwell, a Fade page transition of 400 milliseconds, a Fade character transition of 500 milliseconds, and looping. Seven transition effects are available. Disable a page to omit it.
3. Choose a permitted preview Actor, then use **Resume preview**, **Pause preview**, **Previous page**, **Next page**, or **Preview page** to test the sequence locally. Canvas editing pauses while playback preview runs; choose **Edit selected content** to resume editing. Save the design to publish its pages to linked instances.
4. Select an overlay widget instance and open **Carousel Settings**. Add, remove, or reorder permitted **Assigned Characters**, select **Combined**, arrange information pages, choose initial Actor/page and optional timing overrides, then inspect **Preview Sequence**. The required Pages First order is **A / Page 1 → A / Page 2 → B / Page 1 → B / Page 2**. Optional Characters First traversal is also supported. Save the overlay to publish assignments and overrides.
5. Information Only shows pages for one Actor; Character Only shows Actors on one page; Combined traverses both; Static holds one pair without automatic playback. Use local Pause/Resume and preview navigation before saving. Live Controls can select a saved page/Actor, move to the next/previous step, pause, resume, or reset the sequence in OBS.

Every instance owns one coordinated local timer. Pause preserves remaining dwell; manual navigation keeps the pause state and starts a full selected interval. Dwell begins after preparation and transition, so transition time is added to display duration. Normal Actor updates never restart the sequence. The next character presentation is prepared off screen and switched coherently, keeping its portrait, name and statistics together. Missing Actors are omitted; configured fallbacks or page skipping handle missing fields. Empty Actor lists and zero eligible pages idle safely. Reload starts at the configured available pair and resumes only when saved settings enable it. [CAROUSEL.md](docs/CAROUSEL.md) covers setup, timing, schema/API contracts and acceptance checks.

### Animations, triggers, and live control

1. Select an image, text layer, widget instance, or design component. Open **Animations** in Properties, then configure Entrance, Exit, or Emphasis with type, duration, delay, easing, direction, intensity, and repeat count. **None · immediate** disables a slot. **Preview** and **Reset temporary effects** affect only the editor.
2. In the Widget Designer, use the shared widget animation section for the whole card. Linked instances inherit its animations and triggers. Clear **Inherit shared widget animations and triggers** to configure an independent instance; enabling inheritance again follows future shared-design edits.
3. Open **Triggers → Add trigger rule**. Choose an event, an optional condition, and an action target. Character fields come from the active adapter and mappings. For example, choose a numeric decrease on Health and a temporary red Color Flash on the portrait. Manual rules are listed separately in Live Controls.
4. Under **Value transitions**, choose a positive duration, then enable **Smooth resource bars** and optionally **Interpolate numeric text**. Zero duration keeps immediate updates. A component with zero transition duration inherits a positive grouped-widget duration.
5. Choose an **Editable example → Apply example** for Soft Entrance, Damage Flash, Healing Flash, Low Health Warning, or Slide Entrance. Examples become ordinary editable draft settings; they are not enabled automatically on older overlays. Save the overlay or widget design to publish configuration.
6. Open **Live Controls** from the editor or module settings. Select a saved active overlay, show/hide a layer, play its emphasis or named manual rule, or reset temporary effects. These GM controls affect the stream immediately. Live show/hide saves visibility; temporary automatic trigger actions do not replace saved visibility.

Module setting **Enable overlay animations** defaults to on. **Respect reduced motion** defaults to off, because the capture PC's preference does not describe the stream audience; worlds that already saved a value keep it. Disabling motion resolves numeric transitions to current values and preserves correct visibility. When the client requests reduced motion, the latter setting suppresses **all effects, including Fade In, Fade Out, Pulse and carousel transitions**; pages and characters still change instantly. To honor the output browser's preference instead, open **Game Settings → Modular Stream Overlay → Respect reduced motion** and turn it on. This leaves Windows and Foundry interface preferences unchanged. The preview test panel explains active blockers before playback. Configured repeat counts and durations are bounded; a continuous warning runs only while its condition remains valid.

On reload, output starts with current Actor values and saved visibility. Old damage flashes and other one-shot effects are not replayed; matching continuous warnings are reconstructed. Offline manual effects are not queued for later playback. [PHASE5.md](docs/PHASE5.md) gives the full workflow, supported effects, synchronization behavior, and live acceptance checklist.

### Direct upload storage and validation

Direct upload requires the GM's Foundry `FILES_UPLOAD` permission. It uses the public [`FilePicker.uploadPersistent`](https://foundryvtt.com/api/v14/classes/foundry.applications.apps.FilePicker.html#uploadPersistent) method and the manifest's `persistentStorage` declaration. New images are saved under `modules/modular-stream-overlay/storage/`, which is served through Foundry's normal HTTP(S) routing and works with the existing OBS renderer and route prefixes. It is a Foundry-managed persistent directory, separate from module source assets.

PNG, JPEG (`.jpg`/`.jpeg`), and WebP are accepted, up to **25 MiB per image** (a module limit). Empty files, mismatched or invalid image contents, unsupported formats, missing permissions, storage failures, and invalid upload responses produce errors without changing the previously selected background. Filenames use a generated unique identifier and a validated extension rather than the local filename; existing names are checked before uploading to avoid accidental overwrites. Cancelling the file chooser leaves the draft alone. Each storage request times out after 60 seconds so a lost connection cannot lock the editor indefinitely. Reconnect before retrying; if the upload itself timed out, check Browse Existing because the server might still finish saving that uniquely named file.

Foundry preserves persistent storage across module updates. Reloading Foundry/OBS or restarting the server does not remove uploaded files. [Uninstalling the module removes its persistent storage](https://foundryvtt.com/releases/11.292), so include it in user-data backups. Discarding a draft does not delete an already uploaded file; it remains available through Browse Existing. This update does not move images previously placed in `assets/` or change existing references.

## Presets

Two immutable examples are included: **Empty transparent overlay** and **Basic background overlay**. The second uses a bundled background image that you can replace or remove after loading.

**Save preview as preset** stores the complete current composition, including an unsaved draft, as a new custom preset: background, native canvas resolution, layers and order, text styles, image references, and character-widget preset references/bindings/overrides. **Load & save** immediately saves a copy of the selected preset into the overlay being edited, retaining the overlay's ID and name. If that overlay is active, loading the preset changes the broadcast. With no overlays, loading creates one. Duplicate any preset; rename and delete custom presets. Built-in templates remain available after custom presets are removed. Older presets without layers load with an empty layer collection.

Presets and overlays are world-specific. Viewer-account assignment is a separate world setting and is not copied in a preset.

The Widget Preset Manager stores reusable component designs separately. Full-overlay presets keep references to those shared designs; they do not embed copies. Deleting a widget design leaves its instances and Actor assignments intact, with a missing-design warning in the editor and empty output for that instance. Restore the design or replace the instance to display it again.

## OBS Browser Source setup

This module uses Foundry's existing authenticated **`/stream`** view and public **`streamReady`** hook. It does not depend on arbitrary HTML being served from a module folder, a custom server route, a detached desktop window, or a companion process.

### One-time account setup

1. In Foundry, create a dedicated user such as **OBS Overlay** and give it a password. Any role works; Foundry's permissions for that account decide which characters the overlay can read. An **Assistant GM** already observes every Actor, so no per-Actor access is needed. A **Player** or **Trusted Player** needs **Observer** access to the world Actors intended for the stream. No assigned character is needed.
2. Use this account only for OBS, not the account you play or run the game with. The OBS session can do everything its role allows in Foundry, so keep its password private; with a Player role, leave permissions such as modifying world settings and uploading files disabled. Hiding interface elements does not replace Foundry's permissions.
3. In the overlay editor, select that user under **Viewer account** and click **Save viewer**. Only the selected account renders the overlay; other users opening `/stream?mso=1` see a message instead.

### Connect OBS

1. Run Foundry and keep the world launched. In OBS, create a **Browser Source**. Leave **Local file** disabled.
2. Start with the **Join page** URL shown in the overlay editor (usually `http://localhost:30000/join` on this computer; use your real address and any route prefix).
3. Right-click the Browser Source → **Interact**, and log in as the dedicated viewer. OBS keeps its own browser cookies; logging in using another browser or the Foundry desktop application does not authenticate OBS. The normal game page may briefly appear during this setup, so perform setup before going live.
4. Open the source's properties and replace its URL with the editor's **Browser Source URL**, usually `http://localhost:30000/stream?mso=1`. The query parameter opts into this module's output. An ordinary `/stream` URL retains Foundry's normal stream view.
5. Set Browser Source width and height to the overlay's canvas dimensions, initially **1920** and **1080**. Keep OBS's transparent browser background CSS, or use:

   ```css
   html, body { background: rgba(0, 0, 0, 0) !important; margin: 0; overflow: hidden; }
   ```

6. Leave **Shutdown source when not visible** off when continuous synchronization is desired. The optional **Refresh browser when scene becomes active** setting is not needed for normal updates.
7. Return to Foundry, edit the active overlay, and click **Save overlay**. Foundry's setting notifications update the output without restarting OBS. Active-overlay selection, preset loads, and viewer assignment also synchronize.

If the source initially redirects to Join, authenticate using Interact and then set the overlay URL again; login redirects do not preserve the module's query parameter. Never put a password or GM session token into the URL.

The renderer uses the configured logical canvas and fits it into the Browser Source viewport with transparent margins if aspect ratios differ. If you change canvas dimensions, also update the Browser Source width and height for native pixel-for-pixel output; this does not require restarting OBS.

The GM browser need not stay open after saving. Foundry's server/world and OBS's dedicated session must stay available. On a socket disconnect the scene is cleared; on reconnection the page reloads to fetch authoritative settings. Disabling the viewer clears output and displays setup guidance. An active selection of None produces pure transparency. No assets, settings, or private documents are exported into an unauthenticated endpoint.

If Live Controls times out after updating from 0.5.2, restart Foundry, reopen the world, and refresh both the GM client and the OBS Browser Source. Confirm that the source uses `/stream?mso=1` and is logged in as the selected viewer account. A viewer logged into an ordinary game tab does not receive temporary stream controls. Automatic cycling and saved overlay updates remain independent of manual commands.

### Integration evidence and tradeoffs

The integration was selected after inspecting the installed v14.368 public client code and official documentation:

- [`streamReady`](https://foundryvtt.com/api/v14/functions/hookEvents.streamReady.html) is the documented stream-view lifecycle event. Stream initialization is separate from `ready`; the module registers settings at `init` and mounts only at `streamReady`.
- [`ClientSettings`](https://foundryvtt.com/api/v14/classes/foundry.helpers.ClientSettings.html) supplies world persistence and `onChange` synchronization. Stream clients initialize Foundry's database listeners, so no extra raw-document socket channel is used.
- [Foundry's module socket API](https://github.com/foundryvtt/foundryvtt/issues/582) supplies the enabled module namespace for temporary commands. Unlike the core query receiver, the module's listener is installed in the opted-in stream view. It checks the separate server-supplied sender identity before accepting commands or acknowledgements.
- [`getRoute`](https://foundryvtt.com/api/v14/functions/foundry.utils.getRoute.html) preserves Foundry's configured route prefix for output, join, and asset URLs.
- [Foundry issue #14375](https://github.com/foundryvtt/foundryvtt/issues/14375) explains that module HTML is intentionally served as plain text in v14. A standalone `modules/.../overlay.html` is therefore not the integration method.
- [`ApplicationV2`](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html) and [`FilePicker`](https://foundryvtt.com/api/v14/classes/foundry.applications.apps.FilePicker.html) provide the editor and managed image selection/upload.

The tradeoff is a separate authenticated Foundry session in OBS. It receives whatever data Foundry normally permits that account to access, and an Assistant GM viewer can access everything an Assistant GM can. The module does not turn the viewer account into a public, data-free transport; widgets show only the fields you place on them. Configurations and presets are shared world settings and must contain only stream-safe configuration, never passwords or private notes. Installed extension modules are trusted code and can access the Foundry client themselves.

## Structure

```text
module.json                    Foundry manifest
scripts/main.js                Hooks, GM settings menu, API, lifecycle
scripts/core/schema.js         Versioned validation and built-in presets
scripts/core/layers.js         Layer creation, duplication, and stack ordering
scripts/core/store.js          Overlay/preset operations and persistence
scripts/core/widget-presets.js Dedicated reusable widget design store
scripts/core/registry.js       Widget and adapter registries
scripts/core/background-upload.js Validated persistent background upload
scripts/ui/editor.js           ApplicationV2 editor and private drafts
scripts/ui/widget-editor.js    Widget manager and reused visual designer
scripts/ui/animation-controls.js Visual animation and trigger configuration
scripts/ui/live-controls.js    GM controls for saved live overlays
scripts/animation/             Declarative schema, playback, and trigger runtime
scripts/carousel/              Page/Actor validation, draft helpers, unified sequence and timer
scripts/editor/layer-canvas.js Editor-only selection and direct manipulation
scripts/editor/geometry.js     Native-pixel movement, rotated resize, and shortcuts
scripts/render/renderer.js     Shared DOM renderer; no Foundry document access
scripts/render/character-components.js Live scalar-field presentation
scripts/render/carousel.js     Page presentation, availability, transition cleanup
scripts/render/actor-carousel.js Atomic character presentation and bounded cache
scripts/data/                  Safe bindings, explicit mappings, Actor lifecycle service
scripts/integration/obs.js     Route and viewer-account checks
scripts/adapters/generic.js    Permission-aware actor normalization contract
scripts/adapters/cain.js       CAIN health, level, power, stress, and psyche
templates/editor.hbs           Escaped editor template
templates/widget-manager.hbs  Separate widget design library
templates/live-controls.hbs   Compact live control panel
styles/                        Editor and output styles
assets/basic-background.svg   Bundled preset image
tests/                         Dependency-free Node checks
docs/EXTENDING.md              Public interfaces and schema contracts
docs/DEVELOPMENT.md            Canonical directory and development workflow
docs/PHASE2-TESTING.md          Visual-editor and OBS manual acceptance plan
docs/PHASE3.md                 Character widgets, fields, security, and acceptance
docs/PHASE5.md                 Animations, triggers, live controls, and acceptance
docs/CAROUSEL.md               Combined character/page cycling, timing, API, acceptance
tools/browser-smoke.mjs        Optional isolated browser harness (requires Playwright)
```

## Validation and manual acceptance

With Node.js 22 or later, run inside this folder:

```text
npm run check
npm test
```

There is nothing to install with npm. Automated checks cover manifest/import/syntax validation, schema migration, safe paths and bindings, widget reuse and independent Actor assignments, both preset stores, revision conflicts, permission filtering, adapters/mappings, event subscription cleanup, resource fallbacks, animation timing and replacement, numeric interpolation, safe trigger evaluation, coordinated Actor/page sequencing and cleanup, coherent presentation, and editor behavior. UI tests use a mocked Foundry environment. They do not prove runtime compatibility or OBS behavior.

**Phase 6 acceptance includes native Chromium checks and read-only checks in Foundry 14.368 / CAIN 1.3.26.** All 56 fields matched four real Characters; the native editor, mapping preview, provider dialog and cleanup passed. Production animations also passed in a real Foundry ApplicationV2 with memory-only demo data. A visual smoke check in OBS 32.2.2 confirmed the existing overlay renders real Characters and cycles pages. See the [acceptance report](docs/PHASE6_ACCEPTANCE_RU.md) for exact scopes and evidence. New CAIN presets in OBS, CEF timing/identity instrumentation and live D&D5e acceptance remain outstanding. Follow [CAROUSEL.md](docs/CAROUSEL.md#manual-acceptance) and [PHASE5.md](docs/PHASE5.md#manual-acceptance), retaining the character-widget checks in [PHASE3.md](docs/PHASE3.md) and editing/upload regressions in [PHASE2-TESTING.md](docs/PHASE2-TESTING.md). Earlier phase guides retain their historical results. The manifest intentionally makes no `verified` runtime-build claim.

## Current scope and next steps

Phase 5 adds general animation and trigger configuration to static layers, reusable card designs, grouped instances, and components. Version 0.5.2 coordinates reusable information pages and ordered Actor lists through one sequence per instance. Character values remain read only; playback writes neither Actor documents nor persistent configuration. The existing widget and adapter registries remain supported, with registration APIs for animation types, events, and actions. `configSchema` is extension metadata, not an automatically generated inspector or validation engine. Component style overrides are preserved by the model/API; the editor does not provide a separate style-override inspector.

Next, complete live Foundry/OBS acceptance, then add dedicated adapters for additional systems with fixtures from their public schemas. Carousel instances intentionally run independently; synchronized phases across instances are not included. Synthetic unlinked Token Actors, compendium bindings, initiative/combat tracking, dice visualization, and automatic player-to-character assignment remain outside this phase. See [EXTENDING.md](docs/EXTENDING.md) for extension contracts and [PHASE5.md](docs/PHASE5.md) for animation limits.
