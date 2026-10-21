# D&D5e: secondary player-character adapter

The built-in `dnd5e` adapter is secondary to CAIN and reads prepared public data from world Actors of type `character`. Its interface version is 1. Field availability is restricted to the **5.3.x** line: **5.3.3**, whose installed model was inspected, and its numeric patch releases. Other minor lines and pre-release suffixes stay unavailable. `testedSystemVersions` records this schema/test target; it does not certify a live Foundry or OBS acceptance run.

The current stable D&D5e **6.0.6** was researched and has a synthetic comparison fixture, but is **not enabled as verified support**. An unverified version is rejected by the adapter (direct calls need an explicit version or a matching installed D&D5e version); field-level metadata also lets the character-data service reject unavailable fields. Generic Actor identity remains available where the viewer has permission. System updates must not silently convert this version declaration into a broad compatibility range.

## Fields

| Normalized field | Prepared D&D5e value | Notes |
|---|---|---|
| `character.hp.current` | `system.attributes.hp.value` | Does not include temporary HP. |
| `character.hp.max` | `system.attributes.hp.effectiveMax` | Bar denominator, including the maximum-HP adjustment. |
| `character.hp.baseMax` | `system.attributes.hp.max` | Maximum before the temporary maximum adjustment. |
| `character.hp.temp` | `system.attributes.hp.temp` | Separate temporary HP. |
| `character.hp.percent` | Current / effective maximum | Clamped 0–100; unavailable if the maximum is absent or non-positive. |
| `character.ac` | `system.attributes.ac.value` | Prepared AC, including effects. |
| `character.level` | `system.details.level` | Prepared total character level, including multiclassing. |
| `character.abilities.<ability>.score` | `system.abilities.<ability>.value` | Fixed keys: `str`, `dex`, `con`, `int`, `wis`, `cha`. |
| `character.abilities.<ability>.modifier` | `system.abilities.<ability>.mod` | Prepared modifier; no formula evaluation. |
| `character.resources.<slot>.current` | `system.resources.<slot>.value` | Fixed slots: `primary`, `secondary`, `tertiary`. |
| `character.resources.<slot>.max` | `system.resources.<slot>.max` | Paired with the slot's current field. |
| `character.resources.<slot>.label` | `system.resources.<slot>.label` | At most 80 characters, rendered as text by consumers. |

Each of the 28 fields declares its Actor types, tested system versions (patch releases of the same major.minor are accepted), group and role. Numeric maxima are explicitly paired through `maxField`; health uses `hp` units, ability scores/modifiers and level declare their units. Arbitrary custom slots have no assumed game-specific unit. The four resource descriptors describe health and the three custom slots. Health has `lower-is-worse` polarity; custom slots use `neutral` because their configured labels do not establish whether high or low values are desirable.

Name, portrait, prototype-token artwork, UUID and Actor type come from the existing generic adapter. No duplicate D&D5e identity fields are registered.

## Reading and privacy

The adapter requires Observer permission for the supplied viewer before reading `actor.system`. It returns only requested known scalars. Missing/non-finite numeric values and invalid label types become `null`; strings are not coerced to numbers. It does not inspect source data, traverse Items/ActiveEffects, prepare the Actor, evaluate formulas, roll dice or update documents. Multiclass and effect calculations remain the system's responsibility. The surrounding character-data service retains its world-Actor restriction, authenticated viewer selection and final permission recheck.

NPCs, vehicles, groups, encounters, conditions, spell slots, class summaries and Item uses are deferred. NPC legendary resources use a different `spent/max` model and must not be read through these PC slots. No CAIN resources are aliased to D&D5e's arbitrary resource slots.

## Validation and future support

Synthetic fixtures contain no real Actor or world data. Focused tests exercise prepared HP with `tempmax`, separate temporary HP, finite values, selected-field boundaries, labels, permissions, unsupported Actor types, prepared effect values, multiclass totals, generic identity integration and rejection of unverified versions. The 6.0.6 fixture is a rejection/comparison test, not proof of live compatibility.

Before expanding support to 6.x, run a separate Foundry acceptance pass with an authorized world PC and validate HP, effect-adjusted AC/abilities, multiclassing, custom resources, live embedded-document updates and viewer permissions. Only then add the tested version to field metadata. D&D5e 6.0.6 requires Foundry 14.367 or newer; this module does not upgrade the system or world.

The source investigation and exact local references are in [PHASE6_DND5E_RESEARCH_RU.md](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/docs/PHASE6_DND5E_RESEARCH_RU.md). Primary external references: [5.3.3 manifest](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/system.json), [5.3.3 character model](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/character.mjs), [5.3.3 attribute preparation](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/templates/attributes.mjs), [6.0.6 release](https://github.com/foundryvtt/dnd5e/releases/tag/release-6.0.6), [6.0 changes](https://github.com/foundryvtt/dnd5e/releases/tag/release-6.0.0).
