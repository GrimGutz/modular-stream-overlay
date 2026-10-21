# Phase 6: подготовительное исследование D&D5e

Дата проверки: 21 октября 2026 года. Статус: исследование и проектные рекомендации; адаптер D&D5e не реализован. Приоритет следующей реализации остаётся за CAIN. Систему, миры, документы Actor и настройки не изменяли.

## Проверенная установка и границы доказательств

В `C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e` установлена **D&D5e 5.3.3**. Локальный [system.json](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/system.json:5) объявляет минимум Foundry `13.347` и проверенную основную версию `14`. Это совместимость, заявленная системой; полноценная проверка нового адаптера на живых D&D5e Actor не проводилась.

Пакет содержит объединённый [dnd5e.mjs](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:1) и [карту исходников](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e-compiled.mjs.map:1), а каталога `module/data` в установленном пакете нет. Изучены именно эти локальные файлы. Имена исходных модулей определены по `sources` / `sourcesContent` карты; ниже локальные номера строк относятся к установленному `dnd5e.mjs`, а ссылки GitHub — к исходным файлам соответствующего тега. Номера строк между ними различаются.

Версия и manifest сверены с официальным [тегом release-5.3.3](https://github.com/foundryvtt/dnd5e/releases/tag/release-5.3.3) и его [system.json](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/system.json#L1). Для схем HP, ресурсов, способностей, классов и подготовки уровня проверено соответствие изученных локальных структур исходникам этого тега. Это содержательная сверка выбранных структур, а не криптографическое подтверждение идентичности всего установленного архива.

На дату проверки официальный [releases/latest](https://github.com/foundryvtt/dnd5e/releases/latest) перенаправляет на **6.0.6**. Его [manifest](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/system.json#L1) требует Foundry **14.367** и объявляет `verified: 14`. Установка 5.3.3 и актуальный выпуск 6.0.6 должны рассматриваться как отдельные проверяемые цели. Обновление системы не входит в эту работу.

## Actor и общие поля

Локальный [manifest, documentTypes.Actor](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/system.json:30) перечисляет `character`, `npc`, `vehicle`, `group`, `encounter`. Первый поддерживаемый D&D5e сценарий разумно ограничить `character`; поддержку NPC оформлять отдельно. Наличие Actor в выборе не означает доступности у него всех полей персонажа.

Имя и изображения уже читает общий [genericAdapter](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/adapters/generic.js:3): `actor.name`, `actor.img`, `actor.prototypeToken.texture.src`, `actor.uuid`, `actor.type`. Их IDs `character.name`, `character.portrait`, `character.tokenPortrait`, `character.uuid`, `character.type` не следует дублировать в системном адаптере. Портрет токена означает artwork прототипа, а не произвольного активного токена сцены. Проверку пути/URL сохранять через `safePortrait()`.

Существующий [CharacterDataService](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/data/character-data.js:54) объединяет generic и один адаптер активной системы. Он допускает только мировые Actor, требует Observer-доступ пользователя вывода, повторно проверяет права после асинхронного чтения и возвращает только выбранные поля. Эти свойства нужны и для D&D5e. Чтение биографии, заметок, полных Item/ActiveEffect и передачи сырого `actor.system` не требуется.

## Подтверждённые структуры 5.3.3 и предлагаемые IDs

Все IDs в таблицах — **предложения**, за исключением уже существующих общих полей и HP/уровня CAIN. Они не добавлены в текущий каталог полей. Числа принимать только при `typeof value === "number" && Number.isFinite(value)`; отсутствие, неподдерживаемый тип Actor и некорректное значение возвращать как `null`, не как выдуманный ноль.

| Предлагаемое поле | Источник на подготовленном Actor | Применимость / семантика |
|---|---|---|
| `character.hp.current` | `system.attributes.hp.value` | Текущее HP; не прибавлять временные HP. |
| `character.hp.max` | `system.attributes.hp.effectiveMax` | Рекомендованный знаменатель общей полосы HP; учитывает временную поправку максимума. |
| `character.hp.percent` | Общий расчёт `current / max * 100` | Существующий сервис вычисляет и ограничивает 0–100; при `max <= 0` возвращает `null`. |
| `character.hp.baseMax` | `system.attributes.hp.max` | Необязательное отдельное поле: подготовленный максимум до `tempmax`. |
| `character.hp.temp` | `system.attributes.hp.temp` | Отдельные временные HP. |
| `character.ac` | `system.attributes.ac.value` | Готовый AC с применёнными системными расчётами. |
| `character.level` | `system.details.level` | Только `character`: сумма уровней class Items. Не NPC CR и не уровень заклинателя. |
| `character.abilities.str.score` / `.modifier` | `system.abilities.str.value` / `.mod` | Аналогично для `dex`, `con`, `int`, `wis`, `cha`; фиксированный список. |
| `character.exhaustion` | `system.attributes.exhaustion` | Подготовленное значение; необязательное расширение. |

HP объявлены в локальных [AttributesFields.hitPoints](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:25793) и [CharacterData.defineSchema](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:71946). Существенная деталь находится в [prepareHitPoints](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:26109): `effectiveMax` включает `tempmax`; относительно него система ограничивает текущее HP и вычисляет процент. Поэтому простое копирование старого пути `hp.max` в нормализованный знаменатель может дать другую полосу. Выбор `character.hp.max = effectiveMax` следует зафиксировать в будущем контракте и тестах. При отсутствии подготовленного `effectiveMax` лучше показать недоступность, чем незаметно угадывать значение. Официальный исходник: [5.3.3 attributes.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/templates/attributes.mjs).

AC получать после подготовки из [prepareArmorClass](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:25903), а не из `ac.flat`, `ac.calc` или повторного выполнения формулы. Для score/modifier подтверждены [схема abilities](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:26444) и [prepareAbilities](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:26547). Не вычислять броски, не вызывать игровые действия и не выдавать объект Proficiency за число.

Уровень собирается в [CharacterData.prepareBaseData](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:72054); class Item содержит числовой [system.levels](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:13473). Официальные соответствия: [character.mjs 5.3.3](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/character.mjs) и [item/class.mjs 5.3.3](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/item/class.mjs). Для списка классов доступен `actor.itemTypes.class`; `actor.classes` — словарь по identifier, см. [getter](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:36089). Если позже понадобится `character.classes.summary`, формировать ограниченную строку из разрешённых имён и уровней, не выдавать целые Items. Нельзя превращать произвольные class identifiers в произвольные пути привязок.

## Ресурсы: разные модели character и NPC

У персонажей три пользовательских слота: `system.resources.primary`, `secondary`, `tertiary`. В каждом есть `value`, `max`, `label`, `sr`, `lr`: [схема](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:72014), [makeResourceField](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:72250). Предложения: `character.resources.primary.current`, `.max`, `.label`; аналогично для двух остальных. Привязать `maxField` к `.max`. Название слота не гарантирует игровой смысл: нельзя автоматически объявлять primary «маной», «яростью» или CAIN Power. Ресурсы features/items и spell slots не тождественны этим трём слотам.

У NPC другая [схема](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:73054): legendary actions/resistances используют `max` и **`spent`**. Будущее remaining-значение следует получить как ограниченную разность `max - spent`, а не читать устаревший `.value`. Например, `character.resources.legendaryActions.current` / `.max`, отдельно legendary resistances. `system.details.cr` может быть дробным и требует отдельного `character.challengeRating`; `system.attributes.spell.level` не заменяет уровень персонажа. Официальная схема: [npc.mjs 5.3.3](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/npc.mjs). NPC, vehicle, группы и encounters лучше отложить, чем молча приравнять к PC.

## Состояния и ограничения текущего контракта

Публичный [Foundry v14 Actor.statuses](https://foundryvtt.com/api/v14/classes/foundry.documents.Actor.html#statuses) — `Set<string>` применённых статусов. Он предпочтительнее перебора всех эффектов и их названий: среди effects бывают выключенные, подавленные, enchantment и другие записи, не равные активному состоянию. Системные ключи описаны в [conditionTypes](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:47157), дополнительные — в [statusEffects](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:47336). Это включает также технические/псевдостатусы, поэтому выдавать весь список без выбранного контракта не стоит.

Для будущего ограниченного вывода можно предложить `character.conditions.summary` как короткую строку выбранных локализованных состояний. Для триггера возможен числовой ID вроде `character.conditions.poisoned` со значением 0/1; это должно быть явно описано как индикатор и нормализовано только для известного списка. Сейчас [safeScalar](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/data/character-data.js:23) пропускает числа, строки и изображения, но не массивы и не boolean. Вводить новый тип данных только ради вторичной поддержки D&D5e в CAIN-first этапе не требуется. Прямые поля `character.conditions = []` и boolean без отдельного изменения контракта не заработают.

Exhaustion читать из подготовленного `system.attributes.exhaustion`: [локальный prepareExhaustionLevel](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:26092) восстанавливает его из эффекта. Не завязывать нормализатор на приватные флаги, ID документов эффекта или вывод о смерти только из `HP === 0`.

## Различия с актуальной 6.0.6

[Release notes 6.0.0](https://github.com/foundryvtt/dnd5e/releases/tag/release-6.0.0) описывают изменения AC и ActiveEffect v2. Проверены закреплённые исходники 6.0.6, не подвижная ветка master:

| Область | Проверенное изменение | Следствие для будущего адаптера |
|---|---|---|
| Foundry | Минимум поднят с 13.347 до 14.367. | Совместимость модуля с v14 не доказывает поддержку каждой версии D&D5e. |
| AC | Источники `ac.calcs`, `ac.formulas`, `override`; итог по-прежнему `ac.value`. | Читать готовое значение; не переносить старую логику вычисления. |
| Exhaustion | Источник уровня эффекта стал `effect.system.level` вместо флага. | Готовое `system.attributes.exhaustion` сохраняет полезную границу. |
| HP | `effectiveMax`, `value`, `temp` сохраняют смысл; добавлено подготовленное `hp.bloodied` в процентах. | Не жёстко задавать «bloodied = 50%» без отдельной проверки. |
| Способности | `.value` и `.mod` сохранены; бонусы/roll-конфигурация и proficiency-структуры переработаны. | Ограничить первую поддержку score/modifier; сложные roll-модификаторы отложить. |
| Ресурсы и классы PC | Три ресурсных слота и class `system.levels` сохраняются в изученных схемах. | Всё равно требуются отдельные fixtures и runtime-проверка 6.x. |

Первичные источники этой сверки: [attributes.mjs 6.0.6](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/actor/templates/attributes.mjs), [common.mjs 6.0.6](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/actor/templates/common.mjs), [character.mjs 6.0.6](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/actor/character.mjs), [class.mjs 6.0.6](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/item/class.mjs). Это сравнение исходников, не подтверждение работы модуля на установленной 6.x: такой установки здесь не испытывали.

## Рекомендация для последующей реализации

1. Сначала завершить CAIN-сценарии Phase 6. D&D5e оставить вторичным независимым адаптером, без добавления его system paths в renderer, presets или UI компонентов.
2. В отдельной задаче реализовать минимальный адаптер `systemId: "dnd5e"` для `character`: общий identity остаётся generic; системная часть — HP, AC, level, шесть score/modifier. Использовать нормализованные IDs, числовые `maxField`, чтение выбранных полей, Observer-проверку и `null` при недоступности.
3. Зафиксировать конкретные проверенные версии и поведение вне диапазона; не заявлять универсальную совместимость «любая D&D5e». Добавить fixtures отдельно для 5.3.3 и 6.0.6, затем проверить на живом разрешённом Actor перед объявлением поддержки 6.x.
4. Отложить conditions UI, NPC/vehicle/group, spell slots, произвольные item uses, combat rolls, effects automation, multiclass UI и синтетические Token Actors. Они не нужны для минимального чтения PC и расширяют контракт.
5. Будущие проверки должны покрывать tempmax, отдельные temp HP, нулевой максимум, отсутствующие значения, multiclass, отсутствие Observer-доступа, отзыв прав после чтения, обновления embedded Item/ActiveEffect и неподдерживаемый тип Actor. Существующий [сервис подписок](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/data/character-data.js:181) уже учитывает эти document events; не заменять его параллельным опросом.

В этой подготовке выполнены чтение установленной схемы, изучение встроенной карты исходников, целевая сверка официального тега 5.3.3 и сравнение с текущим стабильным 6.0.6. Изменён только этот документ. Никаких игровых операций, миграций, установки обновлений, реализации адаптера или заявлений об успешном Foundry/OBS тестировании D&D5e не сделано.
