# PF2e: characters and NPCs

The built-in `pf2e` adapter reads prepared public data from world Actors of type `character` and `npc` in the Pathfinder Second Edition system (`pf2e`). Its interface version is 1.

Field availability is restricted to the **8.6.x** line:
- The target is **8.6.1**, the release for Foundry 14 (minimum 14.361, verified 14.368/14.369). The data paths were read from its source (tag `pf2e-8.6.1`).
- Numeric patch releases of 8.6 are accepted. Other minor lines (8.5, 8.7…) and pre-release suffixes stay unavailable until they are checked and added.
- PF2e is not installed on the development machine, so **no live Foundry or OBS run has used this adapter**. `testedSystemVersions` records the schema target, not an acceptance run.

NPC support makes boss and enemy cards possible: creature statistics (health, defenses, saves, attribute modifiers, the death track and conditions) read for NPCs as well. Character-only fields read `null` for an NPC.

## Fields

| Normalized field | Prepared PF2e value | Actors | Notes |
|---|---|---|---|
| `character.hp.current` / `.max` / `.temp` | `system.attributes.hp.value` / `.max` / `.temp` | both | Temporary HP stays separate. |
| `character.hp.percent` | Current / maximum | both | Clamped 0–100; unavailable without a positive maximum. |
| `character.ac` | `system.attributes.ac.value` | both | Prepared AC, including effects. |
| `character.level` | `system.details.level.value` | both | |
| `character.pf2e.perception` | `system.perception.totalModifier` | both | Check modifier. |
| `character.pf2e.saves.<save>` | `system.saves.<save>.totalModifier` | both | `fortitude`, `reflex`, `will`. |
| `character.abilities.<attribute>.modifier` | `system.abilities.<attribute>.mod` | both | `str`, `dex`, `con`, `int`, `wis`, `cha`; same IDs as D&D5e modifiers. |
| `character.pf2e.dying.current` / `.max` | `system.attributes.dying.value` / `.max` | both | Higher is worse. |
| `character.pf2e.wounded.current` / `.max` | `system.attributes.wounded.value` / `.max` | both | Higher is worse. |
| `character.pf2e.doomed.current` / `.max` | `system.attributes.doomed.value` / `.max` | both | Higher is worse. |
| `character.pf2e.conditions` | Condition Items | both | One line per condition, with its value: `Frightened 2`. Empty text when none. |
| `character.pf2e.heroPoints.current` / `.max` | `system.resources.heroPoints.value` / `.max` | character | |
| `character.pf2e.focus.current` / `.max` | `system.resources.focus.value` / `.max` | character | |
| `character.pf2e.shield.current` / `.max` | `system.attributes.shield.hp.value` / `.max` | character | The held shield's hit points. |
| `character.pf2e.xp.current` / `.max` | `system.details.xp.value` / `.max` | character | |
| `character.pf2e.class` / `.ancestry` / `.heritage` | `system.details.<class/ancestry/heritage>.name` | character | The names the system prepares from the character's Items. |

That's 34 fields. Health, AC and level use the same IDs as the D&D5e adapter, and attribute modifiers match D&D5e's, so a design built on them shows data in either system.

Resource descriptors pair health, hero points, focus points, shield hit points and experience (higher is better) with dying, wounded and doomed (higher is worse). **Character colors** suggests coloring characters by class (`accentKeyField`). PF2e itself has no character color.

## Reading and privacy

The adapter requires Observer permission for the configured viewer before reading `actor.system`, and returns only requested known values:
- Non-finite or non-numeric values become `null`; strings are never coerced to numbers.
- Text values are limited to 80 characters (the conditions list to 1,000).
- It reads condition Items by type, name and value only. It never prepares or updates documents, rolls, evaluates formulas, or reads biographies, breakdowns or notes.

Changes to embedded Items and effects already refresh the overlay through the data service, so conditions and class changes appear without reloading.

## Not included yet

Skills, strikes, spellcasting, class DC, speeds, resistances and party or hazard Actors.

## Validation

Synthetic fixtures (`tests/fixtures/pf2e-8.6.1.js`) follow the 8.6.1 prepared-data types and contain no real Actor data. Tests cover:
- every field and the NPC scoping;
- the conditions list;
- invalid values, permissions and Actor types;
- version gating;
- generic identity through the data service.

Before claiming live support, open a PF2e world on Foundry 14 with an authorized character and NPC, and check HP with effects, shield, conditions, hero points and live updates on the stream view.

Source references (tag `pf2e-8.6.1`): `src/module/actor/character/data.ts`, `src/module/actor/creature/data.ts`, `src/module/actor/data/base.ts`, `src/module/item/condition/data.ts` in [foundryvtt/pf2e](https://github.com/foundryvtt/pf2e).
