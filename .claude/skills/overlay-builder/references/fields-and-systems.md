# Character data for any game system

Overlays never read `system.*` paths directly. Every binding is a normalized `character.*` field, supplied by one of three sources:

1. **Always available, any system:** Actor basics (`character.name`, `.callsign`, `.realName`, `.portrait`, `.tokenPortrait`, `.playerAvatar`, `.type`) and Character profiles (`character.profile.accent`, `.fullName`, `.art`).
2. **Built-in adapters:**
   - CAIN 1.3.x: `character.cain.*`, `character.stress.*`, `character.psyche` and more.
   - D&D 5e 5.3.x: `character.hp.*`, `character.ac`, `character.level`, `character.abilities.*`.
   - PF2e 8.6.x, characters and NPCs: shared health, AC, level and modifier IDs, plus `character.pf2e.*` (saves, dying, conditions, hero points, class…).
   - Cyberpunk RED 0.92.x, characters and mooks: shared health IDs plus `character.cpr.*` (humanity, wound state, stats, armor, role…). Cyberpunk RED has no Foundry 14 release yet.

   `character.hp.current`/`.max`/`.percent` exist in D&D 5e, PF2e and Cyberpunk RED, and `character.ac`, `character.level` and `character.abilities.<x>.modifier` in D&D 5e and PF2e. Prefer these shared IDs when a design should work in several systems.
3. **GM field mappings** in the target world, for every other system and for extra values.

List the first two with:

```bash
node .claude/skills/overlay-builder/scripts/fields.mjs --system pf2e     # or cain, dnd5e, cyberpunk-red-core, any, all; add --search hp
```

The module's docs/CAIN.md (in Russian), docs/DND5E.md, docs/PF2E.md and docs/CYBERPUNK_RED.md describe semantics and version limits; read them when a field's meaning matters, such as which CAIN values are "bad when high".

## Systems without an adapter: field mappings

A mapping turns one public `system.*` value into a `character.*` field the overlay can bind. It also extends a built-in adapter with a value it lacks. For example, Cyberpunk RED's walk and run speeds:

```json
[
  { "id": "character.cprx.walk", "label": "Walk speed", "type": "number", "path": "system.derivedStats.walk.value", "systemId": "cyberpunk-red-core", "actorTypes": ["character", "mook"] },
  { "id": "character.cprx.run", "label": "Run speed", "type": "number", "path": "system.derivedStats.run.value", "systemId": "cyberpunk-red-core", "actorTypes": ["character", "mook"] }
]
```

Pick a namespace no adapter uses (here `cprx`), so mappings never collide with built-in IDs.

Rules, enforced when the GM saves the mappings:
- `id`: `character.` plus 1–5 segments of letters, digits and `_`, each starting with a letter. Use a short system namespace (`character.pf2e.hp`). Mappings cannot replace `character.name`, `.portrait`, `.uuid`, `.type` or `.tokenPortrait`.
- `type`: `"number"` or `"string"` only. `path`: `system.` plus 1–6 segments; no expressions, indices, private or descriptive fields (biography, notes, flags, ownership…).
- `maxField` (numbers only) must name another numeric field: an adapter field or a mapping in the same list, so declare the maximum's mapping too.
- `systemId` (the system's id from its system.json) and `actorTypes` limit where the mapping applies. Include them. At most 64 mappings per world.

### Finding the paths

Never guess. In order of preference:
1. If the system is installed in Foundry's Data folder (`<Data>/systems/<id>/`), read `system.json` for the id, then search its code for `system.` paths: `grep -rhoE "system\.[A-Za-z.]+" <Data>/systems/<id>/module | sort | uniq -c | sort -rn | head -40`. Paths used often in actor code are the public stats. Older systems also list fields in `template.json`.
2. Otherwise, ask the user to open a character in Foundry, press F12, run `console.log(JSON.stringify(game.actors.getName("CHARACTER NAME").system, null, 2))` and paste the result.

Values must be plain numbers or strings at that path. Objects, arrays and computed-on-render values don't map.

### Handing mappings to the user

Mappings live in the world, not in the bundle. Save them next to the bundle (`work/generated/<slug>.mappings.json`) and tell the user to add them:

1. Game Settings → Configure Settings → Modular Stream Overlay → **Character Widget Presets** (RU: «Шаблоны виджетов персонажей»).
2. **Advanced field mappings** («Дополнительные привязки полей»). Append the new entries to the JSON array that's already there; don't replace existing ones.
3. **Preview mappings** against a real character, then save.

Until the mappings exist, mapped layers show their `fallback`. The preview script fills mapped fields with sample values automatically, so the layout can be checked first.

## Accent colours

`accent: true` uses, in order: the character's own colour (Character profiles), a colour rule chosen by value in **Character colors** (by default per CAIN blasphemy, PF2e class or Cyberpunk RED role), then the system adapter's colour (only CAIN has one: the blasphemy colour). A system without an adapter colour falls back to the layer's own `color` until the GM sets profile colours or rules. Mention this when the design relies on accents.

## Actors

Bundles carry `$actor:slot` placeholders, never guessed Actor IDs. The installing GM picks real characters in the import dialog, or the user supplies `--actor slot=Actor.ID` if they give IDs. The overlay viewer account (the one OBS uses) needs Observer permission on those characters, or the layers show fallbacks.
