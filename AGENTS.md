# Existing installed Foundry module

This is the existing `modular-stream-overlay` module. Update it in place; do not scaffold another project.

The canonical development directory on this machine is:
`C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay`

Foundry's configuration at `C:\Users\Lev\AppData\Local\FoundryVTT\Config\options.json` declares that user-data path. Confirm `dataPath` and this module's manifest before selecting a different target. The earlier directory under `Documents\Codex\2026-10-19\new-chat\outputs` is a package/staging copy, not the active Foundry installation.

Prefer editing the canonical installed folder and running checks there. Do not silently copy, move, delete, replace, or link whole directories. Do not modify `storage/`, custom assets, other modules, world databases, or Git metadata as part of source changes. User images and existing saved overlay/preset schemas must remain compatible.

When direct writes are unavailable, explain the filesystem restriction. Use the explicit, selective deployment tool described in `docs/DEVELOPMENT.md` only when authorized; do not treat staging edits as installed changes. Never launch a watcher to evade a denied filesystem permission. Preserve all existing Git history if a repository is later added.

Use public Foundry v14 APIs. Keep configuration UI and rendering separate. Before finishing, run `npm run check` and `npm test` from the canonical root (or clearly identify staged-only checks). Do not claim Foundry/OBS runtime checks passed unless actually exercised.
