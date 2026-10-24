# Character and information carousel

Version **0.5.2** coordinates multiple Foundry Actors and multiple information pages in the existing reusable character-widget system. One controller owns the Actor index, page index, transition, and scheduling. With Actors A/B and pages Basic/Attributes, the default combined sequence is **A / Basic → A / Attributes → B / Basic → B / Attributes → A / Basic**.

The module stays in `Data/modules/modular-stream-overlay` of Foundry's user-data folder. The update preserves uploaded images, shared designs, existing Actor assignments, and Phase 5 animations/triggers. It adds no separate module, Actor write, persistent playback log, or per-step network message.

## Create the shared design

1. Open **Widget Preset Manager → Edit / preview**. Choose a permitted **Preview with character** Actor; this sample Actor remains temporary and is never stored in the design.
2. In **Edit content**, select **Shared elements — visible on every page**. Add the portrait, character name, background, and frame here when they should remain in place during information-page transitions. Existing designs retain their original components in this shared collection.
3. Choose **Add page**, name it **Basic Information**, and add the dynamic fields and bars your adapter supports. Add **Attributes** or **Resources** with additional layouts. Field names come from the adapter or explicit mappings; unsupported statistics are never invented.
4. Switch between shared elements and each page to edit its component layout. Put artwork inside pages when the entire card should change. Rename, duplicate, reorder, delete, or disable pages. Duplicated components receive new IDs and their internal trigger targets follow those IDs.
5. In **Cycling settings**, choose the default mode and enable automatic cycling. Set a default dwell of 5 seconds, optionally set Attributes to 8 seconds, choose a page transition, then configure a separate character-change transition such as Fade for 500 milliseconds. Set looping and a starting page.
6. Use the local preview controls to test the design. **Resume preview**, **Pause preview**, **Previous**, **Next**, and page preview affect only this editor. Canvas editing pauses during sequence preview; return to editing before changing the layout.
7. Choose **Save widget design**. Saved changes publish the common design to its linked instances. Layout, bindings, page order, timing defaults, and transition effects belong to the reusable design; Actor assignments do not.

## Assign characters and preview the combined sequence

1. In the overlay editor, add a widget from that design or select an existing widget instance.
2. Open its **Carousel Settings** section. Choose **Combined**, then use **Add Character** for each permitted world Actor. The assigned-character list supports removal and reordering. Dragging a supported Foundry Actor onto the assignment area also adds it.
3. Arrange Actors A then B. Arrange the information pages Basic then Attributes. Choose an initial Actor/page, optional page-duration overrides, page transition, character transition, and loop behavior. Inherited values follow the shared preset; overrides affect only this instance.
4. Inspect **Preview Sequence**. Pages First displays A / Basic, A / Attributes, B / Basic, B / Attributes. Characters First instead displays A / Basic, B / Basic, A / Attributes, B / Attributes.
5. Use local Pause/Resume and navigation to verify the draft. Choose **Save overlay** to publish its assignments and overrides. Previewing does not send a temporary command to OBS or save runtime playback state.

The same design can serve one instance assigned A/B/C and another assigned D/E. They retain independent positions, Actor order, overrides, playback positions, and timers.

## Modes and settings

| Mode | Playback |
| --- | --- |
| Information Only | One selected Actor, all enabled information pages |
| Character Only | All assigned available Actors, one selected information page |
| Combined | All eligible Actor/page pairs in the selected traversal order |
| Static | One Actor/page pair; no automatic advancement, including after Resume |

Pages First is the default traversal: finish the information pages for one Actor, then advance to the next Actor and restart at the first enabled page. Characters First is also supported: finish the Actors for one page, then advance to the next page. A character-only design without explicit information pages uses its existing shared design as one runtime presentation; no artificial page is saved.

| Setting | Meaning |
| --- | --- |
| Automatic cycling | Saved automatic start behavior; default off on older designs |
| Assigned Characters | Up to 20 unique world Actor UUIDs in playback order |
| Information Page Order | Shared design order, optionally reordered per instance; disabled pages are omitted |
| Initial Actor / page | Configured starting pair, with a first-available fallback |
| Default page duration | 5 seconds by default; 0.1–3600 seconds |
| Per-page duration | Optional design duration or instance override; otherwise the default |
| Page transition | Fade, four slide directions, Scale, or Instant Switch |
| Character transition | Independent choice from the same seven effects; Fade/500 milliseconds by default |
| Transition durations | Page default 400 milliseconds; each accepts 0–10000 milliseconds |
| Loop | Return to the first eligible pair after the last; default on |
| Page enabled | Includes or excludes a page from all Actor sequences |
| Skip unavailable information | Omits that Actor/page pair when the page has no usable dynamic data |

Transitions use the Phase 5 engine and preserve layout coordinates, scaling, rotation, and configured opacity. An Actor change uses the character transition once, even when the page also changes. Animation disable and reduced motion make the switch immediate while the sequence continues.

## Timing and reload policy

Each widget instance has **one coordinated scheduler and at most one scheduled advancement timeout**. Character and information cycling never run on competing timers. The display duration starts after the next presentation is ready and its transition finishes: transition/preparation time is **added to** the configured page dwell. Five seconds of dwell plus a 500-millisecond transition therefore takes at least 5.5 seconds. Fewer than two eligible pairs require no automatic advancement timer.

- **Pause** preserves the current pair and remaining dwell. **Resume** continues that remaining time; it may temporarily run a non-static carousel whose saved automatic setting is disabled.
- **Manual select**, **Next**, **Previous**, and **Select Character** preserve the pause state. A running sequence starts a full dwell on the selected pair. Selecting the current pair also restarts its dwell. Next/Previous wrap only when Loop is enabled.
- **Reset sequence** returns to the configured starting pair, falling back to the first eligible pair, and starts a full dwell while preserving the pause state.
- **Loop disabled** holds the final pair after its dwell. It does not silently start another loop.
- **Hidden widgets** suspend scheduling and retain remaining dwell. Showing them resumes if otherwise running. Replacing saved configuration may rebuild the widget and start from its configured initial state.
- **OBS reload, restart, or a fresh composition** starts from the defined initial Actor/page pair. Automatic playback resumes only when saved settings enable it. Temporary selections, pause state, elapsed time, timers, and transition frames are not persisted.

Actor updates do not restart the carousel. If availability changes, the controller keeps the current pair when it remains eligible; otherwise it chooses the next eligible pair or the starting fallback. It does not replay missed steps. Replacing or destroying a widget cancels its timer, transitions, subscriptions, and obsolete asynchronous work. Instances remain independent; their phases and local preview state are not synchronized with one another or with OBS.

## Consistent data and missing information

All fields use the existing permission-aware `CharacterDataService` and normalized adapter bindings. The GM preview checks the configured OBS viewer's access too. No Actor document snapshot or private system path is embedded in a design or command.

Before changing characters, the renderer prepares the next Actor's entire presentation off screen, including shared portrait/name and every page's fields. It switches the coherent presentation atomically, so one Actor's portrait cannot appear beside another Actor's statistics. At most two prepared Actor presentations are retained, with a bounded collection of selected normalized scalar values for assigned off-screen Actors. Off-screen updates keep those values current without creating another carousel timer; returning to an Actor resolves the latest authorized values. Permission changes invalidate unavailable data.

The departing card remains coherent while incoming reads finish. Character exit and entrance share the configured character-transition duration; the next full dwell starts after preparation and both transition phases complete. Rapid requests cancel obsolete preparations. A page change on the Actor still displayed uses the page effect, even when it interrupts an unfinished request for another Actor.

Missing fields use the component's configured fallback. **Skip this page when no dynamic information is available** instead omits a pair when none of that page's visible dynamic components has a usable value for its Actor. A finite number, boolean, or nonempty text qualifies; a resource bar requires finite current data and a positive finite maximum. Static decoration and fallback labels do not make missing dynamic information available. A partially populated page remains eligible, with fallbacks for missing components.

Unavailable or unauthorized Actors are omitted safely. Empty Actor lists, zero enabled pages, or no eligible pairs leave the sequence idle with no skip loop or advancement timer; stale character data is cleared. Later permitted data can make a pair eligible again. Explicitly disabled pages are never replaced with a synthetic page. No guessed values are substituted.

## Control saved widgets in OBS

Open **Live Controls** from the overlay editor or module settings. A saved widget provides page/character targets, Previous, Next, Pause, Resume, and Reset Sequence. These selectors choose a command target; they do not report the remote widget's current pair or pause state.

Commands use the module's expiring socket transport, compatible with the native stream view in v0.5.3. The receiver verifies Foundry's server-supplied sender identity is a GM and that it is the selected viewer account. Unavailable viewers produce an error; old commands are never queued for reconnect. Configuration saves remain separate from temporary playback, and normal sequence steps remain local to OBS. Acknowledgment means the command was accepted, not that a long transition has finished. New requests cancel superseded transitions.

For a GM macro:

```js
const api = game.modules.get("modular-stream-overlay").api;
const layerId = "your-saved-widget-layer-id";
await api.liveControls.carousel(layerId, "pause");
await api.liveControls.carousel(layerId, "select", "basic", "Actor.A");
await api.liveControls.carousel(layerId, "select-actor", undefined, "Actor.B");
await api.liveControls.carousel(layerId, "reset");
await api.liveControls.carousel(layerId, "resume");
```

The signature is `carousel(layerId, action, pageId?, actorUuid?)`. Actions are `select`, `select-actor`, `next`, `previous`, `pause`, `resume`, and `reset`. `select` requires a page ID and may also choose an assigned Actor; `select-actor` requires an assigned Actor UUID. Commands address a widget in the saved active overlay and carry only semantic identifiers, never character values.

## Saved configuration and compatibility

Overlay state, overlays, and full-overlay presets use **schema 6**, accepting versions 1–5. Widget designs and their library use **schema 4**, accepting versions 1–3. Reads normalize isolated copies without writing a migration. Explicit saves persist the current schema. Older designs retain their shared layers, empty pages, disabled automatic cycling, and existing binding behavior.

A reusable design stores:

```js
{
  pages: [
    { id: "basic", name: "Basic Information", enabled: true,
      duration: null, skipIfUnavailable: false, layers: [] },
    { id: "attributes", name: "Attributes", enabled: true,
      duration: 8000, skipIfUnavailable: true, layers: [] }
  ],
  cycling: {
    enabled: true, mode: "combined", traversal: "pages-first",
    duration: 5000, transition: "fade", transitionDuration: 400,
    characterTransition: "fade", characterTransitionDuration: 500,
    loop: true, startPageId: "basic"
  }
}
```

The instance stores Actor identities and optional overrides:

```js
{
  type: "character-widget", presetId: "fantasy-card",
  actorUuid: "Actor.A", actorUuids: ["Actor.A", "Actor.B"],
  carousel: {
    enabled: null, mode: "combined", traversal: null,
    actorStartUuid: "Actor.A", pageOrder: ["basic", "attributes"],
    startPageId: "basic", duration: null, pageDurations: { attributes: 8000 },
    transition: null, transitionDuration: null,
    characterTransition: null, characterTransitionDuration: null, loop: null
  }
}
```

Null scalar overrides inherit the preset. A partial `pageOrder` puts those pages first and appends the remaining enabled design pages. Unknown removed-page references are ignored during resolution. Per-instance duration overrides take precedence over design per-page durations, which take precedence over the default. `actorStartUuid` must belong to the assigned list.

The legacy `actorUuid` field remains as the first-Actor compatibility alias. When `actorUuids` is absent, it supplies the old single-character binding; when `actorUuids` is present, that list is authoritative. In particular, `actorUuids: []` deliberately means no assigned characters and never restores an old `actorUuid`. Reusable designs never retain these identities. Active Actor/page indices, pause state, countdowns, and frames remain runtime state.

A design supports at most **20 pages** and **100 components across shared elements and pages**; an instance supports at most **20 Actors**, bounding the combined sequence to 400 pairs. IDs, timing, safe assets, and bindings are validated. Pages cannot recursively contain pages, grouped widget instances, or legacy widgets. See [EXTENDING.md](EXTENDING.md#widget-information-pages) for exact exports and local controller interfaces.

## Source inventory

| Area | Files and responsibility |
| --- | --- |
| Schema and draft operations | `scripts/carousel/schema.js`, `scripts/core/schema.js`, `scripts/core/widget-presets.js`: assignments, bounded settings, resolution, migrations, page helpers |
| Unified scheduling | New `scripts/carousel/sequence.js` builds Actor/page traversal and wraps the existing single-timer `scripts/carousel/runtime.js` scheduler |
| Presentation | New `scripts/render/actor-carousel.js`, existing `scripts/render/carousel.js`, `renderer.js`, and `motion.js`: coherent Actor preparation, page layouts, transitions, visibility and cleanup |
| Commands | `scripts/main.js`, `scripts/animation/commands.js`, `scripts/animation/transport.js`: saved-widget control and authenticated ephemeral delivery |
| Editor | `scripts/ui/editor.js`, `widget-editor.js`, `live-controls.js`, templates and styles: assignments, order, overrides, sequence preview, live navigation |
| Tests | Combined schema/sequence/renderer/UI regressions alongside existing animation, lifecycle, binding, preset and command tests |

## Validation

Run `npm run check` and `npm test` from the canonical installed module directory. The suite uses controlled timers and mocked Foundry/UI integrations; these checks do not establish real browser timing or a live OBS pass.

Canonical-folder validation completed on **2026-10-20**: `npm run check` verified the manifest, referenced assets, imports and syntax for **65 JavaScript files**. `npm test` completed with **329 passing, 0 failing, 1 skipped** (330 total). The existing Windows symbolic-link/junction test is skipped because the environment does not permit creating test symlinks. The editor and live-control templates also compiled with Foundry's installed Handlebars package, and rendered controls retained correct layer, Actor and page identifiers.

Combined regressions exercise the required A/1 → A/2 → B/1 → B/2 order with one scheduling timer, mode/traversal behavior, transition timing, private editor drafts, authenticated semantic commands, slow and superseded Actor reads, permission revocation during preparation, off-screen updates, independent instances, resize geometry, effects and subscription cleanup. They also cover existing single-character page carousels and earlier animation/binding behavior.

**Actual Foundry/OBS/browser acceptance remains unverified.** Complete the checks below alongside [PHASE5.md](internal/PHASE5.md#manual-acceptance), [PHASE3.md](internal/PHASE3.md), and [PHASE2-TESTING.md](internal/PHASE2-TESTING.md). Record Foundry/system/OBS versions, enabled modules, and results. Earlier guides retain historical automated counts.

## Manual acceptance

- [ ] Open old designs/overlays and confirm images, layout, bindings, geometry and disabled automatic behavior remain compatible.
- [ ] Create Basic/Attributes pages and assign Actors A/B. Confirm the default required order A/Basic → A/Attributes → B/Basic → B/Attributes, then loop to A/Basic.
- [ ] Exercise Information Only, Character Only, Combined and Static. Confirm Static never auto-advances. Test Characters First separately.
- [ ] Add/remove/reorder Actors with both picker and supported drag/drop. Reorder and disable pages, set starts and overrides, save/reopen, and inspect the sequence preview.
- [ ] Verify all seven transitions, separate Actor/page effects, zero durations, rotation, clipping, opacity, scaling and editor zoom. A character boundary must use one coherent transition.
- [ ] Use 5-second and 8-second dwells with a 500-millisecond character transition. Confirm dwell starts after preparation/transition and no competing timer advances a second index.
- [ ] Change Actor values while visible and off screen. Returning presentations must show the correct portrait, name and all current statistics without mixed identities, old damage flashes or sequence restart.
- [ ] Pause midway through a dwell, wait and Resume. Next/Previous, page/character selection and Reset must preserve pause state and use a full selected dwell.
- [ ] Disable looping and hold the final pair. Reload with saved starts and automatic settings; temporary playback state must not persist.
- [ ] Test unavailable Actors, revoked/regranted permissions, partial missing fields and invalid resource maxima. Test skip on all pairs, an empty Actor list and zero enabled pages; no stale values or infinite loop may remain.
- [ ] Reuse a design with separate A/B/C and D/E instances. Their Actor data, navigation, pause state and timers must remain independent.
- [ ] Run combined cycling in authenticated OBS with the editor closed. Test online/offline Live Controls, reload and reconnect; page steps need no repeated GM command, configuration write or Actor write.
- [ ] Hide/show, remove/recreate and rapidly navigate widgets. Confirm cleanup, current-target cancellation and no accumulating timers/subscriptions.
- [ ] Disable animation and request reduced motion. The correct sequence and current values must remain, with immediate switches.
