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

1. Use **Add Image** or **Add Text** to create a layer. For images, use the existing upload or Browse Existing workflow in the selected layer's properties, or drop PNG, JPEG or WebP files onto the canvas, or paste a copied image or screenshot with Ctrl/Cmd+V: each is uploaded and becomes an image layer, scaled down to fit the canvas when it is larger, centered or where it was dropped. Uploads use the same persistent storage and validation as background images.
2. Click a layer on the canvas or in the Layers panel. Drag its body to move it; drag a selection handle to resize it. Shift/Ctrl/Cmd+click on the canvas or in the Layers panel adds a layer to the selection or removes it, and dragging a rectangle from empty space or from a locked layer (such as a locked background) selects every visible, unlocked layer entirely inside it. Dragging any selected layer moves the whole selection, which snaps as one block; a click without dragging selects just that layer. Several selected layers get their own frame with resize handles and a rotation handle: resizing scales every unlocked layer's position and size from the frame (Shift keeps the frame's proportions; aspect-locked layers keep theirs), and turning moves each layer around the frame's center (Shift: 15° steps). Hold **Alt** to see distances in pixels from the selection to the nearest layer on each side or the canvas edges; with Alt held, hovering another layer measures to it, or to its inner edges when it contains the selection. Resize handles appear when one layer is selected, with a round rotation handle above it: drag it to turn the layer around its center, hold Shift for 15° steps; near-straight angles snap to 0°, 90°, 180° and −90° unless Alt is held or snapping is off. Canvas fit and zoom change only the view: positions and sizes are always stored in the overlay's native pixels. Image aspect-ratio locking preserves its current box proportions during resizing.
   The expand button beside the canvas heading opens a full-screen canvas: the editor window fills the screen (and the browser enters full screen where allowed), the overlay list and settings panels are hidden, and the canvas takes the free space with Tools, Layers/Properties and Save beside it. Click it again or leave browser full screen (Esc) to return; the window gets its previous size back. Foundry dialogs such as the image picker keep working. Both the overlay editor and the widget designer have it.
   **Rulers & guides** shows rulers along the canvas in overlay pixels. Drag from the top ruler for a horizontal guide or from the left ruler for a vertical one; drag a guide to move it (its position shows while dragging) and drop it back on a ruler to remove it. Guides are kept per overlay or widget design in this browser and never appear in OBS. **Grid** draws a 10–100 px grid. Layers snap to guides and grid lines while snapping is on.
   While dragging or resizing, the layer snaps to other layers' edges and centers, to the canvas edges and middle, and to equal spacing in a row or column (centered between two neighbours, or repeating an existing gap). Pink lines show the alignment, blue lines the canvas middle and orange labels the equal gaps in pixels. Hold **Alt** to place freely, or turn off **Snapping** next to the zoom control; the choice is remembered per browser. Rotated layers and aspect-locked resizing are not snapped; arrow-key nudges never snap. Both the overlay editor and the widget designer have it, and the designer's page view also snaps to shared elements.
3. Edit the selected layer's name, position, size, rotation, opacity, visibility, and lock state in Properties. **Align on the canvas** puts one layer at the canvas edges or center. With several layers selected, Properties shows how many are selected, shared properties (opacity, font, size, weight, color, visibility and lock; a blank field or "mixed" means the layers differ) that change every selected layer having them, buttons to align their left, center, right, top, middle or bottom to the selection's bounds, to distribute three or more with equal gaps horizontally or vertically, and Bring to front, Send to back, Duplicate and Delete for all of them. Locked layers count for the bounds but never move or get deleted. Image layers provide Contain, Cover, and Stretch; text layers provide content, a font, size, weight, color, alignment, and optional shadow. Text is displayed as text, including literal HTML-like characters.
   The font list starts with common local fonts (Arial, Verdana, Georgia, Times New Roman, Courier New, Trebuchet MS), followed by every font Foundry knows: its bundled fonts (such as Signika, Modesto Condensed, Amiri) and the fonts added in **Game Settings → Configure Fonts**, including ones uploaded to the world. The editor and the OBS page load those font files from Foundry, so text matches on both.
4. Use the Layers panel to select, show/hide, lock/unlock, duplicate, delete, or reorder layers. Higher layers cover lower layers. Double-click a layer's or group's name to rename it (Enter saves, Esc cancels), and type in **Search layers** to list only layers whose name or group name contains the text (Esc clears it). Drag rows to restack them: dropping on a group's layer moves the dragged layers into that group, dropping on an ungrouped layer or above a group's row takes them out, and dragging a group's row moves the whole group.
   **Groups:** select layers and press Ctrl/Cmd+G (or **Group** in Properties); Ctrl/Cmd+Shift+G ungroups. A group is one block in the list with its name, member count, a collapse arrow, and visibility and lock buttons for all members. Clicking a grouped layer on the canvas selects the whole group, which drags, aligns and copies together; click it again to edit just that layer. Selecting exactly one whole group shows its name for renaming. Up/Down/Front/Back on a grouped layer stay inside its group, and other layers step over a group as one block. Copies of a group form a new group. Groups only organize the editor; OBS shows the layers as before. Locked layers cannot be dragged, resized, or nudged. Hidden layers remain editable through the layer list and do not appear in OBS.
5. With the editor focused and outside editable controls, use arrow keys to move the selected layers by 1 native pixel, Shift+arrow by 10 pixels, Delete/Backspace to delete, Ctrl/Cmd+D to duplicate, Ctrl/Cmd+A to select every visible unlocked layer and Esc to clear the selection. Ctrl/Cmd+C copies the selected layers, Ctrl/Cmd+X cuts them and Ctrl/Cmd+V pastes them on top with their spacing and order (offset when they would cover the originals). Copies go to the system clipboard as text, so they can be pasted into another overlay, widget design or page, another world, or Foundry in another browser; pasted layers are validated like any saved layout. A widget pastes only where its widget design exists. Pasting other text creates a text layer with it. If a browser refuses clipboard access, the last copy made in that browser is pasted instead. Ctrl/Cmd+Z undoes and Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redoes every draft change, including property edits, for the last 100 steps; a drag or a typed value counts as one step, and saving keeps the history. Shortcuts follow the physical keys, so they also work with a Russian layout. Widget instances cannot be pasted into widget designs, nor character components into overlays. Text fields, number inputs, selections, and other editable controls keep their normal shortcuts.
   **Fragments** in the tools panel keep a selection or group (for example a character plate) by name: **Save selection as fragment**, then click a fragment to insert it into any overlay or widget design as one undo step; copies of a group become a new group. The library is shared by the world's GMs; inserting follows the same rules as pasting.
6. Click **Save overlay** to publish the layout. Preview selection borders, handles, layer controls, and checkerboard never appear in OBS. Unsaved changes remain local; **Reload saved** restores the saved composition after confirmation when needed. **Versions** lists the last 30 saves of this overlay or widget design kept in this browser (the first save also keeps the version before it); restoring one puts it in the editor as unsaved changes, so Save publishes it and Ctrl/Cmd+Z goes back. Versions stay on this computer and are not sent to other clients or OBS.
   Edits update the preview layer by layer: unchanged layers, including character widgets and their carousels, keep running while you edit, undo or open other windows, and OBS likewise rebuilds only the layers a save changed.

Rotation is entered numerically. Resize handles follow the layer's rotation. Missing image files are hidden without removing other content. Text clips to its layer box; enlarge the box when more content should be visible. Font files come only from Foundry's own font configuration; the common local fonts depend on the computer, so on the OBS computer choose a Foundry font or one installed there too for matching metrics.

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

This module uses Foundry's existing authenticated **`/stream`** view and public **`streamReady`** hook. It does not depend on arbitrary HTML being served from a module folder, a custom server route or a detached desktop window. An optional local [OBS connector](#obs-connector-optional) can sign OBS in automatically.

### One-time account setup

1. In Foundry, create a dedicated user such as **OBS Overlay** and give it a password. Any role works; Foundry's permissions for that account decide which characters the overlay can read. An **Assistant GM** already observes every Actor, so no per-Actor access is needed. A **Player** or **Trusted Player** needs **Observer** access to the world Actors intended for the stream. No assigned character is needed.
2. Use this account only for OBS, not the account you play or run the game with. The OBS session can do everything its role allows in Foundry, so keep its password private; with a Player role, leave permissions such as modifying world settings and uploading files disabled. Hiding interface elements does not replace Foundry's permissions.
3. In the overlay editor, select that user under **Viewer account** and click **Save viewer**. Only the selected account renders the overlay; other users opening `/stream?mso=1` see a message instead.

### Connect OBS

1. Run Foundry and keep the world launched. In OBS, create a **Browser Source**. Leave **Local file** disabled.
2. Use the editor's **Browser Source URL** as its only URL, usually `http://localhost:30000/stream?mso=1` (use your real address and any route prefix). The query parameter opts into this module's output; an ordinary `/stream` URL retains Foundry's normal stream view.
3. If OBS shows Foundry's sign-in page, right-click the Browser Source → **Interact** and sign in as the dedicated viewer. Foundry then returns to the overlay URL by itself. OBS keeps its own browser cookies; signing in using another browser or the Foundry desktop application does not authenticate OBS.
4. Set Browser Source width and height to the overlay's canvas dimensions, initially **1920** and **1080**. Keep OBS's transparent browser background CSS, or use:

   ```css
   html, body { background: rgba(0, 0, 0, 0) !important; margin: 0; overflow: hidden; }
   ```

5. Leave **Shutdown source when not visible** off when continuous synchronization is desired. The optional **Refresh browser when scene becomes active** setting is not needed for normal updates.
6. Return to Foundry, edit the active overlay, and click **Save overlay**. Foundry's setting notifications update the output without restarting OBS. Active-overlay selection, preset loads, and viewer assignment also synchronize.

Foundry keeps sign-ins only in server memory for at most 24 hours, so after Foundry restarts OBS shows the sign-in page again; sign in once more, or use the connector below. Changing the viewer's password also signs it out. Never put a password or GM session token into the URL.

### OBS connector (optional)

`tools/obs-connector.mjs` runs on the streaming PC and signs OBS in automatically, including after Foundry or the world restarts. OBS keeps one URL and never needs Interact.

1. Install Node.js 22 or later. Double-click `tools/obs-connector.bat` in the module folder, or run `node tools/obs-connector.mjs setup` once.
2. Enter the Foundry address (`http://localhost:30000`), the viewer account's name exactly as Foundry lists it, its password and a port (default `30001`). Settings are saved to `%APPDATA%\modular-stream-overlay\obs-connector.json`, outside Foundry's Data folder.
3. Set the OBS Browser Source URL to `http://localhost:30001/` and keep the connector window open while streaming. To start it with Windows, put a shortcut to `obs-connector.bat` in the Startup folder (`Win+R` → `shell:startup`).

Until Foundry is running, a world is launched and sign-in succeeds, the connector serves a transparent page that checks again every 5 seconds, so nothing appears on stream. When the connection drops, the overlay page reloads itself once the connector answers. The connector window reports what it is waiting for, such as no world launched, an unknown account name or a wrong password; it never prints the password.

Anything that reaches the connector acts as the viewer account. It therefore listens on `127.0.0.1` only, accepts only its own host and origin (other websites in your browser cannot use it), forwards only GET/HEAD requests and the stream socket, and refuses Foundry's other pages such as `/game`, `/setup` and `/join`. The password is stored in plain text in the settings file on that PC; use a dedicated viewer account and keep the file private. Run `setup` again to change it.

The renderer uses the configured logical canvas and fits it into the Browser Source viewport with transparent margins if aspect ratios differ. If you change canvas dimensions, also update the Browser Source width and height for native pixel-for-pixel output; this does not require restarting OBS.

The GM browser need not stay open after saving. Foundry's server/world and OBS's dedicated session must stay available. On a socket disconnect the scene is cleared; on reconnection the page reloads to fetch authoritative settings. Behind the connector it also reloads once Foundry is reachable again after its own reconnection attempts give up. Disabling the viewer clears output and displays setup guidance. An active selection of None produces pure transparency. No assets, settings, or private documents are exported into an unauthenticated endpoint.

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
scripts/core/saved-versions.js Saved versions of overlays and designs in this browser (IndexedDB)
scripts/core/fragments.js      Shared library of saved layer fragments
scripts/core/registry.js       Widget and adapter registries
scripts/core/background-upload.js Validated persistent background upload
scripts/ui/editor.js           ApplicationV2 editor, private drafts, selection, clipboard, undo
scripts/ui/editor-inspector.js Layer properties, styles, alignment buttons, multi-selection panel
scripts/ui/editor-characters.js Widget instance characters, profiles and per-instance carousel
scripts/ui/editor-text.js      Localized labels, errors and dialogs for the editor panels
scripts/ui/editor-layers.js    Layers panel: groups, toggles, drag and drop restacking
scripts/ui/widget-editor.js    Widget manager and reused visual designer
scripts/ui/animation-controls.js Visual animation and trigger configuration
scripts/ui/live-controls.js    GM controls for saved live overlays
scripts/animation/             Declarative schema, playback, and trigger runtime
scripts/carousel/              Page/Actor validation, draft helpers, unified sequence and timer
scripts/editor/layer-canvas.js Editor-only selection and direct manipulation
scripts/editor/geometry.js     Native-pixel movement, rotated resize, and shortcuts
scripts/editor/snapping.js     Snapping to layers, the canvas and equal spacing
scripts/editor/arrange.js      Selection bounds, alignment and distribution
scripts/editor/history.js      Undo/redo snapshots (100 steps)
scripts/editor/clipboard.js    Layer clipboard text format and in-browser fallback
scripts/editor/rulers.js       Canvas rulers in overlay pixels
scripts/editor/measure.js      Alt distances to neighbouring layers and edges
scripts/render/renderer.js     Shared DOM renderer; no Foundry document access
scripts/render/character-components.js Live scalar-field presentation
scripts/render/carousel.js     Page presentation, availability, transition cleanup
scripts/render/actor-carousel.js Atomic character presentation and bounded cache
scripts/data/                  Safe bindings, explicit mappings, Actor lifecycle service
scripts/integration/obs.js     Route and viewer-account checks
scripts/integration/fonts.js   Foundry font list and font loading for the editor and OBS
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
