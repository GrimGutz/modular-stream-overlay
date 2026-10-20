# Phase 5: animation and trigger engine

Version **0.5.0** extends the existing installed module in `C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay`. It adds configurable visual reactions to images, text, grouped character widgets, shared designs, and individual design components. Existing uploads, assets, layout geometry, Actor bindings, preset libraries, and the authenticated `/stream?mso=1` output remain in place.

The **0.5.1 information-page addition** extends this engine with reusable widget pages, local automatic cycling, shared components, seven page transitions, and temporary GM page controls. Current schemas are overlay **5** and widget preset **3**; the schema and validation counts below describe the original 0.5.0 animation milestone. See [CAROUSEL.md](CAROUSEL.md) for current page contracts, timing policy, source inventory, and additional acceptance checks, and [EXTENDING.md](EXTENDING.md) for the current API.

## Configure and preview

1. Restart Foundry after the manifest update, then refresh the GM page and OBS source once. Keep the existing dedicated Player viewer and Observer permissions for displayed Actors.
2. Select a layer or widget component in the visual editor. Open **Animations**, then Entrance, Exit, or Emphasis. Choose an animation, duration and delay in milliseconds, easing, direction, intensity, and repeat count. Choose **None · immediate** to clear a slot.
3. Use the slot's **Preview** button. It plays locally without saving the draft, altering Actor data, or sending a live command. **Reset temporary effects** clears local playback. Zoom, native coordinates, resize geometry, rotation, and configured opacity remain intact.
4. Open **Value transitions**. Set a positive duration and choose Smooth resource bars, Interpolate numeric text, Smooth colors, or Smooth opacity as needed. Numeric interpolation is optional. Duration zero gives immediate updates unless a component inherits a positive grouped-widget duration.
5. Under **Triggers**, add a rule, give it a name, and choose its event, optional condition, action, and target. Use supported character fields from the active adapter or explicit mappings. **Preview rule locally** tests that rule inside the editor. It does not simulate changes to the real character.
6. Save with **Save overlay** or **Save widget design**. Reopen the saved item to confirm the configuration. Invalid timing, conditions, or fields block saving rather than publishing a partially valid rule.

The Widget Designer also exposes a shared widget animation section for the whole card. Put a portrait reaction on the portrait component, or use a whole-widget rule with that component as its action target. A component target is a stable component ID; **This element / whole widget** uses `self`.

### Shared designs and independent instances

New grouped instances have **Inherit shared widget animations and triggers** enabled. Saving shared animation configuration updates linked instances while preserving each Actor UUID, position, size, rotation, and component overrides. Each instance evaluates its own character values; damage to A does not trigger B's widget.

Clear the inheritance checkbox to copy the current shared configuration into that instance and edit it independently. This sets `animationOverrides:true`: the complete instance configuration is authoritative, including empty rules and null slots that disable inherited effects. Re-enabling inheritance sets the marker false and follows the shared configuration again. Component animation/trigger overrides are also accepted through the model/API.

A component's positive transition duration takes precedence. A zero component duration inherits a positive grouped-widget transition duration, allowing one setting to coordinate bar and number updates throughout a card. Old designs without animation settings retain immediate behavior.

## Supported animations and rules

| Category | Effects |
| --- | --- |
| Entrance | Fade In; Slide In Left, Right, Top, Bottom; Scale In; Pop In |
| Exit | Fade Out; Slide Out Left, Right, Top, Bottom; Scale Out |
| Emphasis | Pulse, Flash, Shake, Bounce, Glow, Color Flash, Scale Pulse |
| Value transitions | Resource percentage, optional numeric text/template values, configured color and opacity changes |

Effects use browser animation APIs and preserve the underlying design. Emphasis on one target replaces the previous emphasis rather than accumulating a queue. Temporary glow/color effects restore the configured appearance. Animation frames are never saved to settings.

Pulse scales 1 → 1.12 → 1 at intensity 1; Flash changes opacity, while Glow changes the filter. The test panel uses 1200 ms for Pulse. Whole-widget play/preview targets the outer layout surface, composing with its saved rotation. Visibility effects hold their initial frame during delay and their final frame until their visibility owner completes, then release all temporary styles. Reduced-motion and disabled settings remain authoritative; a command acknowledgement alone does not establish playback. See [ANIMATION_FIX_REPORT.md](ANIMATION_FIX_REPORT.md) for the 0.5.5 investigation and verification limits.

Animation duration is **1–10000 ms**, delay **0–10000 ms**, intensity **0–2**, and repeat count an integer **1–20**. Delay plus all repetitions must fit within **60000 ms**. Transition duration is **0–10000 ms**. Easings are Linear, Ease In, Ease Out, and Ease In Out; direction is Normal, Reverse, or Alternate. Hexadecimal effect colors are supported. Unknown safe animation IDs remain stored and produce no effect until registered.

| Events | Conditions | Actions |
| --- | --- | --- |
| Becomes visible; becomes hidden; field changes; numeric increase/decrease; crosses above/below threshold; manual | Equals; not equals; greater/less than; greater/less than or equal; increased/decreased; crossed above/below | Play animation; show; hide; temporary glow; temporary color flash; animate numeric value |

A rule separates the event from its optional condition and action. Numeric comparisons require finite numeric thresholds. Fields use normalized IDs such as `character.hp.current` and `character.hp.percent`, not executable expressions or system document paths. Missing or invalid values do not count as a match. Crossing below 25 means a valid previous value was at least 25 and the new value is below 25; remaining below 25 does not repeatedly fire a one-shot crossing rule.

Use **Keep effect active while condition matches** for a warning that should persist. It requires a character-data condition and an emphasis action. A low-health warning can use a field change with `character.hp.percent < 25`; it starts when matching, stops at 25 or above, stops when hidden/unavailable, and is reconstructed on reload only if current data still matches. This controlled effect has one owned animation channel rather than a growing set of timers.

### Editable examples

**Editable example → Apply example** copies ordinary settings into the current draft:

| Example | Initial configuration |
| --- | --- |
| Soft Entrance | Fade In, 500 ms, Ease Out |
| Damage Flash | Red Color Flash, 400 ms, on a decrease in supported current HP |
| Healing Flash | Green Color Flash, 400 ms, on an increase in supported current HP |
| Low Health Warning | Gentle 1400 ms pulse while supported HP percentage is below 25 |
| Slide Entrance | Slide In Left, 600 ms, Ease Out |

Change fields, targets, timing, colors, thresholds, or rules after applying an example. Examples are optional and do not fabricate health fields in unsupported systems. Health percentage uses the existing adapter/mapping contract, from 0 to 100. Generic Actor basics remain available; CAIN or explicit supported mappings supply resources.

## Live Controls and persistent visibility

Open **Live Controls** from the overlay editor or module settings. A GM can choose the saved active overlay, view its layers/widget instances, use **Show/Hide**, **Play emphasis**, a named **Manual trigger**, or **Reset effects**. Draft preview controls are separate from this panel.

The panel lists manual rules authored on layers and whole widgets. To manually animate a portrait or number component there, add a whole-widget manual rule targeting that component. A component's own manual rule can also be tested with its local preview button.

The active-overlay selection and panel Show/Hide save the intended live state through the existing overlay store. They synchronize through Foundry's setting notifications and survive reconnecting. Reset and emphasis are temporary commands. Automatic trigger Show/Hide actions change runtime visibility only; they do not overwrite the saved layer design. Reloading restores saved visibility. To keep a manual visibility change across reconnects, use the panel Show/Hide buttons.

Saved-hidden layers remain mounted invisibly so Show rules can target them and data triggers can reveal them. Hiding a whole widget stops its components' continuous effects and preserves their own visibility choices. Showing it reconstructs only warnings whose current conditions still match.

Manual controls require a GM. The receiving context checks Foundry's authenticated sender identity, validates the active overlay/target/rule, rejects expired or repeated commands, and accepts no arbitrary script. Manual commands target the current saved active overlay; they do not publish an unsaved editor draft.

## Live data, synchronization, and reconnects

Character updates use the established `CharacterDataService` and Foundry's authenticated Actor/document update delivery. Each affected instance resolves selected normalized scalar values, compares its previous/current snapshot, evaluates rules, and runs visual actions locally in that rendering context. No raw Actor document is copied into preset data or broadcast over a new module socket.

Saved animation configuration uses the existing world-setting synchronization. As of v0.5.3, manual playback uses the public **module socket namespace** with semantic commands, because native `/stream` does not install Foundry's incoming `User.query` handler. Foundry supplies the actual sender ID separately from the payload; the receiver requires that User to be a GM. Commands have identifiers, bounded lifetime, and deduplication. There is no offline playback queue: disconnected viewers do not receive a backlog of expired effects when they reconnect.

Only the configured Player's opted-in OBS sessions execute commands and acknowledge them. Ordinary game sessions ignore them. If several OBS sources use the same account, a stale source's rejection cannot beat a healthy source's success. If no opted-in source acknowledges, Live Controls explains how to restart Foundry and refresh the source; the command is never saved for later playback.

On a cold mount or OBS reload, the module reads current saved configuration and Actor values, displays the latest values directly, and establishes a comparison baseline. It suppresses historical one-shot damage/healing reactions during reconstruction. As of v0.5.4, configured entrances run after the visible outer scene is mounted. Continuous effects are restored from conditions that remain valid. Saved visibility is restored; temporary automatic visibility is not a second persistent state.

HP/resource bars interpolate their clamped percentage without rebuilding their track/fill nodes. Optional number interpolation uses integer steps when both endpoints are integers, otherwise short decimal steps; its final text uses the exact current value. Rapid changes continue from the value currently displayed and finish at the latest target. Missing values, a non-positive maximum, or revoked permissions cancel stale transitions and use the existing safe fallback. These operations never modify Actor HP or other document data.

## Motion settings and cleanup

The world settings **`animationsEnabled`** and **`respectReducedMotion`** default to true and are configured by a GM. Disabling animations immediately settles numeric values and completes visibility changes correctly. Respecting a client's reduced-motion preference suppresses moving/flashing playback; it remains a per-client browser/OS preference. Prefer a gentle pulse or glow with lower intensity for less flashing.

Playback uses transforms/opacity where practical, browser-owned animation effects, and a bounded numeric frame loop. Each target owns replaceable channels. Removed/replaced layers clean up effects, frame requests, data subscriptions, and pending callbacks. Geometry and editor controls are outside temporary visual changes. There are no heavyweight animation dependencies, arbitrary JavaScript expressions, continuous Actor writes, or animation-frame settings writes.

## Saved schema and extension API

Overlay state, overlays, and full-overlay presets now use **schema 4**, accepting versions 1, 2, and 3. Widget preset state and designs use **schema 2**, accepting version 1. Reads normalize isolated copies; opening an editor or OBS does not write a migration. Explicit store mutations persist current versions. Missing animation settings become null slots, a zero-duration transition, and no trigger rules.

Layers and reusable designs store `animations` plus `triggers`. Grouped instances additionally store `animationOverrides:false` by default. The full schema, bounds, registries, and API usage are in [EXTENDING.md](EXTENDING.md#animations-and-triggers). Runtime playback, interpolated values, event IDs, and temporary effects are excluded from saved data.

Trusted extensions can register animation types, event predicates, and actions through `api.animations.registerType`, `registerEvent`, and `registerAction`. GM automation can use `api.liveControls.getState`, `setActive`, `setVisibility`, `play`, and `reset`, or open the panel with `api.openLiveControls()`. Register on `modularStreamOverlayInit` so registrations exist in both ordinary and native stream views.

## Source inventory

| Area | Files / responsibility |
| --- | --- |
| Model | `scripts/animation/schema.js`; `scripts/core/schema.js`; `scripts/core/widget-presets.js`: bounded configuration, examples, migrations, preset round trips, instance overrides |
| Runtime | `scripts/animation/playback.js`, `scripts/animation/triggers.js`, `scripts/animation/commands.js`, `scripts/animation/transport.js`: browser playback, numeric channels, safe comparisons, previous/current evaluation, authenticated expiring semantic commands |
| Integration | `scripts/render/motion.js`, `scripts/render/renderer.js`, `scripts/render/character-components.js`, `scripts/main.js`: motion orchestration, shared preview/stream surfaces, stable data-driven DOM, settings, lifecycle, command/API wiring |
| UI | `scripts/ui/animation-controls.js`, `scripts/ui/live-controls.js`, `scripts/ui/editor.js`, `scripts/ui/widget-editor.js`, `scripts/editor/layer-canvas.js`: animation/rule inspector, isolated preview, shared design controls, live panel |
| Presentation | `templates/editor.hbs`, `templates/live-controls.hbs`, `styles/editor.css`, `styles/renderer.css`: controls and shared output styling |
| Packaging | `module.json`, `package.json`: version 0.5.0 and manifest references |
| Checks | Animation schema/playback/trigger/UI tests plus core, presets, renderer, character renderer, lifecycle, and integration regressions |
| Documentation | This guide, `README.md`, `docs/EXTENDING.md`; earlier phase guides remain historical records |

User `storage/`, custom assets, other modules, worlds, and Git metadata are outside these source changes.

## Validation and manual acceptance

Run `npm run check` and `npm test` from the canonical installed module folder. Automated tests exercise bounded schemas and migrations, independent instances, previous/current thresholds, continuous start/stop, effect replacement, semantic command validation, numeric interpolation, rapid updates, disabled/reduced motion, cleanup, preset round trips, and mocked UI/rendering. They do not establish real browser timing, visual quality, or native Foundry/OBS delivery.

The test script runs test files sequentially to avoid native test-runner failures observed with concurrent test processes on this machine's Windows Node 26 installation. No npm dependencies are required.

Canonical-folder validation completed on 2026-10-20: `npm run check` verified the manifest, assets, relative imports, and syntax for 52 JavaScript files. `npm test` completed with **236 passing, 0 failing, 1 skipped** (237 total). The skip is the existing Windows symbolic-link/junction test because this environment does not permit creating test symlinks. The full run also covers hidden Show targets, nested visibility cleanup, initial targets constructed later, native stream hook/query wiring, persistent live visibility, and continuous whole-design effects at changing zoom. Foundry application objects and browser animation APIs are mocked in those checks.

**Live Foundry/OBS and actual browser acceptance remain unverified.** Earlier local browser attempts could not launch or reach the test harness in this environment. No OBS animation, reconnect, live CAIN, or live permission pass is claimed. Record Foundry build, system/version, OBS/browser versions, enabled modules, and results when completing these checks.

### Manual acceptance

- [ ] Open an existing saved overlay and widget design; confirm original assets, bindings, layouts, presets, and active selection survive.
- [ ] Configure and save image/text entrance, exit, and emphasis settings; reopen and confirm each value.
- [ ] Preview every built-in animation at different zooms, rotations, and opacity. Confirm native coordinates and editor handles remain correct and OBS receives no preview command.
- [ ] Preview/reset repeatedly, close/reopen the editor, and add/delete/reorder layers. Confirm no lingering effects or visible growth in active animations/subscriptions.
- [ ] Apply/edit all five examples. Check field availability and safe fallbacks on supported and unsupported systems.
- [ ] Assign one shared card to Actors A and B. Decrease/increase A's supported HP; verify only A's widget plays its damage/healing effect in authenticated OBS.
- [ ] Exercise crossing above/below a threshold; remaining on the same side must not replay one-shots. Check exact equality at the threshold.
- [ ] Put HP below 25%, verify continuous warning starts, returns to normal at 25% or above, stops when hidden, and restores appropriately after reload.
- [ ] Enable bar/numeric interpolation, then make rapid consecutive changes. Confirm stable geometry and correct final values. Test missing values, zero maximum, changed maximum, negative/over-maximum HP, deleted Actors, and revoked permissions.
- [ ] Edit shared animations; confirm linked instances retain their Actors and geometry. Turn inheritance off for A, disable or replace an effect, and verify B continues following the shared design.
- [ ] Target a portrait or number component from a whole-card rule. Verify temporary colors/glow restore the saved appearance and numeric actions do not modify real Actor data.
- [ ] Use Live Controls to switch the saved active overlay, show/hide, play emphasis/manual rules, and reset. Confirm live Show/Hide survives reload; temporary automatic Show/Hide restores saved visibility on reconnect.
- [ ] Reload OBS while HP is low and after a damage flash. Confirm current values/saved visibility and valid continuous warning restore; no old one-shot/entrance/damage flash replays.
- [ ] Disconnect OBS, play manual effects, and reconnect. Confirm there is no queued playback. Verify duplicate/expired commands and a non-GM sender cannot affect output.
- [ ] Disable animations globally and enable the browser/OS reduced-motion preference. Confirm latest values and intended visibility settle correctly and flashing/moving effects are suppressed.
- [ ] Repeat background upload, explicit-save/conflict, Actor picker/mapping, and layout regressions from [PHASE2-TESTING.md](PHASE2-TESTING.md) and [PHASE3.md](PHASE3.md).

## Remaining limits

Live visual and native OBS acceptance is still required. Manual commands are transient and intentionally unavailable to offline clients; automatic visibility is runtime-only. This is a general visual engine, with no initiative/combat tracking, dice visualization, or game-specific event requirement. Existing world-Actor identity/permission limits and adapter support still apply. Component presentation overrides remain an advanced model/API feature; no separate style-override editor, full preset portability/import-export, or synthetic Token/compendium binding is added.
