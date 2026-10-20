# Canonical development workspace

The active module on this computer is:

```text
C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay
```

This is established by the configured `dataPath` in `C:\Users\Lev\AppData\Local\FoundryVTT\Config\options.json` and the October 19 Foundry startup log, which identifies the same directory and v14.368. The module manifest has ID `modular-stream-overlay`. The earlier code in `Documents\Codex\2026-10-19\new-chat\outputs\modular-stream-overlay` is a package/staging copy, not the active installation.

Before this update, all code files in the two copies matched. The installed module additionally contained the user's existing background JPEG under `assets/`; that file is deliberately preserved. Neither inspected module root contained `.git`, so there was no module Git history to move or rewrite. No directory junction, symbolic link, directory move, or directory deletion is needed.

## Preferred workflow: edit in place

Open the installed module directory as the project folder in Codex or your editor. Work and run checks there:

```powershell
Set-Location -LiteralPath 'C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay'
npm run check
npm test
```

Source edits in that folder are the files Foundry serves. Refresh the Foundry client after JavaScript/template/style changes. Restart the Foundry server after manifest changes, including enabling persistent storage for version 0.1.1. OBS may need a one-time Browser Source refresh after a code update; normal saved overlay changes still sync automatically.

`AGENTS.md` in the module describes this canonical root for future coding work. This chat also records that root in its own workspace instructions. A chat cannot change its host's selected project directory through a source-file edit; use the installed module folder when opening a new Codex project. Filesystem write access must include that folder. The earlier read-only access grant does not itself permit installed-source edits.

## Fallback: selective automatic deployment

If an environment requires the source to remain elsewhere, the existing source can be used with `tools/foundry-dev.mjs`. It reads the actual Foundry options file rather than assuming a default user-data directory. It checks both manifests and copies only module source/development files. It never mirrors or deletes directories, does not copy image binaries from a user's computer, and leaves installed-only assets, persistent `storage/`, `.git`, and world data alone.

From the existing source folder, inspect the target and differences first:

```powershell
node tools/foundry-dev.mjs --config 'C:\Users\Lev\AppData\Local\FoundryVTT\Config\options.json' --check
```

Apply a checked update, or keep automatic updates running while editing that source:

```powershell
node tools/foundry-dev.mjs --config 'C:\Users\Lev\AppData\Local\FoundryVTT\Config\options.json' --apply
node tools/foundry-dev.mjs --config 'C:\Users\Lev\AppData\Local\FoundryVTT\Config\options.json' --watch
```

Run the watcher in a terminal with access to the installed module and leave it running. It performs an initial selective update and watches for later source changes; no repeated manual copying is required. Stop it with Ctrl+C. It refuses unexpected destination edits during that run instead of erasing concurrent installed-source changes. Do not run it against a different developer's active checkout. If source and installed root are already the same, it reports direct development and does not copy.

The watcher is an explicit fallback, not permission escalation. If a sandbox denies writes, the tool must be run in an environment where the user has granted access. It is never launched automatically to bypass that restriction.

## Background uploads and source updates

New direct uploads use Foundry's supported persistent storage at:

```text
<Foundry User Data>/Data/modules/modular-stream-overlay/storage/
```

Foundry preserves this managed directory during module updates. It is separate from source assets and is removed if the package is uninstalled. Keep it in normal user-data backups. Do not overwrite it with deployment or add it to source control. Existing manually placed image references remain valid; this update does not move them or rewrite existing settings/presets.
