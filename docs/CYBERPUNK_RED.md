# Cyberpunk RED: characters and mooks

The built-in `cyberpunk-red` adapter reads public data from world Actors of type `character` and `mook` in the Cyberpunk RED Core system (`cyberpunk-red-core`). Its interface version is 1.

> **Status: waiting for a Foundry 14 release of the system.** Cyberpunk RED Core 0.92.4, the latest release, supports Foundry 12 only. The team's development line, 0.93, targets Foundry 13. This module requires Foundry 14, so the adapter can only run once Cyberpunk RED publishes a Foundry 14 release, and its version is checked and added here.

Field availability is restricted to the **0.92.x** line:
- The target is **0.92.4**. Its data models were read from the installed system (`modules/datamodels/actor/*`).
- The 0.93 development changelog lists no changes to these values.
- **No live Foundry or OBS run has used this adapter.**

## Fields

| Normalized field | Cyberpunk RED value | Actors | Notes |
|---|---|---|---|
| `character.hp.current` / `.max` | `system.derivedStats.hp.value` / `.max` | both | Same IDs as the D&D5e and PF2e health fields. |
| `character.hp.percent` | Current / maximum | both | Clamped 0–100. |
| `character.cpr.woundState` | `system.derivedStats.currentWoundState` | both | The system's translated name (Russian «Серьёзное ранение» with a Russian Foundry), or English. |
| `character.cpr.deathSave` | `system.derivedStats.deathSave.value` | both | |
| `character.cpr.deathSavePenalty` | `system.derivedStats.deathSave.penalty` | both | |
| `character.cpr.humanity.current` / `.max` | `system.derivedStats.humanity.value` / `.max` | both | Humanity can be negative. |
| `character.cpr.stats.<stat>` | `system.stats.<stat>.value` | both | `int`, `ref`, `dex`, `tech`, `cool`, `will`, `luck`, `move`, `body`, `emp`. |
| `character.cpr.stats.luckMax` / `.empMax` | `system.stats.luck.max` / `system.stats.emp.max` | both | Paired with LUCK and EMP. |
| `character.cpr.armor.<location>.current` / `.max` | `system.externalData.currentArmor<Body/Head/Shield>.value` / `.max` | both | Stopping power of the equipped body armor, head armor and shield. |
| `character.cpr.role` | `system.roleInfo.activeRole` | both | The active role's name. |
| `character.cpr.reputation` | `system.reputation.value` | both | |
| `character.cpr.wealth` | `system.wealth.value` | character | Eurobucks. |

That's 29 fields. Resource descriptors pair health, humanity, LUCK and the three armor locations, all with lower-is-worse polarity. **Character colors** suggests coloring characters by role (`accentKeyField`).

## Reading and privacy

The adapter requires Observer permission for the configured viewer before reading `actor.system`, and returns only requested known values. Non-finite or non-numeric values become `null`; text is limited to 80 characters. It never reads ledgers, transactions, lifepath, notes or aliases, and never updates documents.

## Not included yet

Skills, weapons and ammunition, cyberware, critical injuries, Netrunning, Black ICE and Demon Actors.

## Validation

Synthetic fixtures (`tests/fixtures/cyberpunk-red-0.92.4.js`) follow the 0.92.4 data models and contain no real Actor data. Tests cover:
- every field and the mook scoping;
- wound state translation;
- invalid values, permissions and Actor types;
- version gating;
- generic identity through the data service.

When Cyberpunk RED supports Foundry 14, compare its data models with this table, add its version to `TESTED_VERSIONS` in `scripts/adapters/cyberpunk-red.js`, and run a live check with an authorized character and mook.
