# Existing installed Foundry module

This is the existing `modular-stream-overlay` module. Update it in place; do not scaffold another project.

The canonical development directory on this machine is:
`C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay`

Foundry's configuration at `C:\Users\Lev\AppData\Local\FoundryVTT\Config\options.json` declares that user-data path. Confirm `dataPath` and this module's manifest before selecting a different target. The earlier directory under `Documents\Codex\2026-10-19\new-chat\outputs` is a package/staging copy, not the active Foundry installation.

Prefer editing the canonical installed folder and running checks there. Do not silently copy, move, delete, replace, or link whole directories. Do not modify `storage/`, custom assets, other modules, world databases, or Git metadata as part of source changes. User images and existing saved overlay/preset schemas must remain compatible.

When direct writes are unavailable, explain the filesystem restriction. Use the explicit, selective deployment tool described in `docs/DEVELOPMENT.md` only when authorized; do not treat staging edits as installed changes. Never launch a watcher to evade a denied filesystem permission. Preserve all existing Git history if a repository is later added.

Use public Foundry v14 APIs. Keep configuration UI and rendering separate. Before finishing, run `npm run check` and `npm test` from the canonical root (or clearly identify staged-only checks). Do not claim Foundry/OBS runtime checks passed unless actually exercised.

## Authoring overlays and widget designs

For a new layout, use the existing JSON authoring toolkit described in [docs/OVERLAY_AUTHORING.md](docs/OVERLAY_AUTHORING.md). Start from `examples/authoring/basic.json`, `character.json` or `animated.json`; generate with `node tools/overlay-author.mjs generate <source.json> --out work/generated/<name>.json`, then validate the generated bundle with `node tools/overlay-author.mjs validate <bundle.json>`.

Use real layer/schema fields and normalized `character.*` bindings. Keep Actor assignments on overlay instances, not reusable presets. Declare Actor slots as `$actor:name` and resolve them with repeatable `--actor name=Actor.ID` or during runtime installation; use `$preset:name` plus `--ref name=existing-preset-id` for existing designs. Preserve ordered carousel assignments and choose fresh record IDs. Do not invent CSS/schema properties, embed Documents, modify database files, or rewrite rendering/animation engines to create a layout.

Generation writes a local bundle only; optional `--macro <path>` also creates a GM Script Macro that opens the import dialog. Install through the running module's `scripts/authoring/bundle.js` importer as a GM, with runtime validation and an explicit Install action; use `dryRun: true` for inspection. Keep the active overlay and existing records unchanged. Do not silently install, publish, overwrite collisions, assign guessed Actors, or alter viewer permissions. Existing module safeguards above still apply.

## Bilingual configuration UI

Read [docs/LOCALIZATION.md](docs/LOCALIZATION.md) when adding interface text. Keep matching namespaced keys and `{parameters}` in `lang/en.json` and `lang/ru.json`. Use `t`, `setText`/`setAttr` from `scripts/ui/i18n.js`, and `msoT` with explicit `data-i18n` markers in templates. Mark dedicated caption spans, not inputs or user content. Use `errorText` at UI validation boundaries; do not localize engine data or adapter output.

`interfaceLanguage` is a client setting: `auto` reads public `game.i18n.lang` (regional RU supported, otherwise EN), while `en`/`ru` override only this module. Never change Foundry's global language. Language refresh must preserve draft objects, input nodes/focus, renderers, animation playback and carousel timers. Do not translate user names/text, preset IDs, mappings or stream content. New keys require both dictionaries and the focused localization tests, followed by the normal checks above.
