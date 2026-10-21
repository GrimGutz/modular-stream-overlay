# Phase 6 — карта фактических данных CAIN, подготовительный аудит

Дата: 21 октября 2026. Это исследование и предложение границ будущей интеграции. Функциональный код, схема оверлея, настройки, Actors, Items, базы миров, пакеты и файлы системы не изменялись. Для исследования читались исходники установленной системы; примеры ниже синтезированы из схемы и не содержат данных персонажей пользователя.

## 1. Версия, происхождение и степень подтверждения

Установлена система `cain` версии **1.3.26**, `minimum:11`, `verified:14`, `maximum:14`. Источник истины для этой карты — `C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain`. Точка входа — `module/cain.mjs`; `template.json` перечисляет типы, но не содержит полную схему: её задают зарегистрированные `TypeDataModel`.

Открыты официальная [страница пакета CAIN](https://foundryvtt.com/packages/cain), [основной репозиторий](https://github.com/diabeatz96/cain) и [релиз v1.3.26](https://github.com/diabeatz96/cain/releases/tag/v1.3.26). Пакет направляет на релиз `diabeatz96/cain`; страница релиза показывает commit `fbd0eca`. README указывает `bugeso/cain1.3` как development repository. В локальном manifest остались URL этого development repository; само по себе это не доказывает локальные изменения.

Выполнено **сравнение текстового содержимого** шести ключевых локальных файлов с `https://raw.githubusercontent.com/diabeatz96/cain/v1.3.26/<path>`, без сохранения загрузок. Перед сравнением CRLF приведены к LF и убраны завершающие LF. Все шесть пар совпали. Ни версия manifest отдельно, ни это ограниченное сравнение не означают проверку всего архива, всех файлов или идентичность байтов с исходными переводами строк.

| Файл | Результат | SHA-256 нормализованного локального и опубликованного текста |
| --- | --- | --- |
| `system.json` | Совпадает | `5247d9b3add48aecd905f9005c27f0ae46631d0c2145a2982b7db0afff618bff` |
| `module/data/actor-character.mjs` | Совпадает | `babbfddc53672c315334b50ab639c2b58fe744913d1b0bb689c6c395c8b35237` |
| `module/data/base-actor.mjs` | Совпадает | `1f982c24be5ca686fe5da85207795d746374a18fdba76dd8ee34355c699bbe33` |
| `module/data/actor-opponent.mjs` | Совпадает | `d138d9346ddc8d78071e5751e36ad6cc5018c1d182fbe67c45701cf904169562` |
| `module/cain.mjs` | Совпадает | `76ba49154ad4bcbb113ab2854a40fa93aeb750679becebfb8eca2ca0f4998b4b` |
| `module/sheets/actor-sheet.mjs` | Совпадает | `cf4fc03b57f75d03da81a8aa3f37c394bd3179d8439d59d880e959680f1ceae7` |

Схема Character дополнительно просмотрена через браузер в [исходнике тега v1.3.26](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/actor-character.mjs). Остальные локальные модели прочитаны как часть установленной системы; отдельное внешнее побайтовое сравнение для них не заявляется.

## 2. Указатель локальных источников

Обозначения в колонке «Источник» раскрываются ниже. Числа после обозначения — реальные строки в прочитанном файле, а не номера строк HTML-страницы GitHub.

| Код | Локальный источник | Публичный источник той же версии, где применимо |
| --- | --- | --- |
| BOOT | [module/cain.mjs:123](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/cain.mjs:123) | [v1.3.26, регистрация моделей](https://github.com/diabeatz96/cain/blob/v1.3.26/module/cain.mjs#L123) |
| B | [module/data/base-actor.mjs:5](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/base-actor.mjs:5) | [v1.3.26, base actor](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/base-actor.mjs#L5) |
| C | [module/data/actor-character.mjs:5](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/actor-character.mjs:5) | [v1.3.26, character](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/actor-character.mjs#L5) |
| S | [module/data/actor-sin.mjs:5](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/actor-sin.mjs:5) | [v1.3.26, sin](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/actor-sin.mjs#L5) |
| M | [module/data/actor-mundane.mjs:5](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/actor-mundane.mjs:5) | [v1.3.26, mundane](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/actor-mundane.mjs#L5) |
| O | [module/data/actor-opponent.mjs:5](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/actor-opponent.mjs:5) | [v1.3.26, opponent](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/actor-opponent.mjs#L5) |
| CFG | [module/helpers/config.mjs:109](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/helpers/config.mjs:109) | [v1.3.26, CAIN skills](https://github.com/diabeatz96/cain/blob/v1.3.26/module/helpers/config.mjs#L109) |
| D | [module/documents/actor.mjs:5](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/documents/actor.mjs:5) | [v1.3.26, Actor document](https://github.com/diabeatz96/cain/blob/v1.3.26/module/documents/actor.mjs#L5) |
| SH | [module/sheets/actor-sheet.mjs:174](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/sheets/actor-sheet.mjs:174) | [v1.3.26, Actor sheet](https://github.com/diabeatz96/cain/blob/v1.3.26/module/sheets/actor-sheet.mjs#L174) |
| H | [module/components/hunt-tracker/hunt-tracker.mjs:268](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/components/hunt-tracker/hunt-tracker.mjs:268) | [v1.3.26, Hunt Tracker](https://github.com/diabeatz96/cain/blob/v1.3.26/module/components/hunt-tracker/hunt-tracker.mjs#L268) |
| P | [module/components/pathos-tracker/pathos-tracker.mjs:71](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/components/pathos-tracker/pathos-tracker.mjs:71) | [v1.3.26, Pathos Tracker](https://github.com/diabeatz96/cain/blob/v1.3.26/module/components/pathos-tracker/pathos-tracker.mjs#L71) |
| TF | [templates/actor/parts/actor-features.hbs:235](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/templates/actor/parts/actor-features.hbs:235) | Локальный шаблон CAT, XP, Divine Agony, Injuries, Stress |
| TC | [templates/actor/actor-character-sheet.hbs:40](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/templates/actor/actor-character-sheet.hbs:40) | Локальный лист Character: идентичность, skills, Psyche и общие сведения |
| TP | [templates/player-overview/overview.hbs:33](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/templates/player-overview/overview.hbs:33) | Локальный сводный экран игроков |
| TX | [templates/player-overview/xp.hbs:26](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/templates/player-overview/xp.hbs:26) | Локальные полосы Sin Overflow, Kit Points, XP, Advancements |

## 3. Что является основными механиками

Основные поля карточки exorcist — **CAT, Psyche, Psyche Bursts, Stress, Injuries, Divine Agony, Sin Overflow, Kit Points, XP/Advancements, Scrip и десять навыков CAIN**. Это подтверждают модель C, шаблоны TF/TX/TP и обработчики листа SH. CAT и generic level — разные пути. `psyche` пересчитывается из CAT.

`system.health`, `system.power` и `system.attributes.level` действительно существуют. Первые два унаследованы из общей базы; level задан в Character и используется в `getRollData().lvl`. Это не доказательство, что health — основной игровой запас здоровья CAIN, power — Psyche Bursts, а level — CAT. В просмотренных основных шаблонах Character отображаются специфические счётчики CAIN. В исходниках остались `str/dex/con/int/wis/cha` и комментарии про d20, но Character schema **не определяет** `abilities`. Эти остатки шаблонного кода нельзя превращать в характеристики CAIN.

Текущий [cainAdapter](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/adapters/cain.js:5) публикует health/power/level, stress и psyche. На Phase 6 следует сохранить старые идентификаторы и их прежнюю семантику для совместимости, а нативные CAT/Bursts/Agony/Injuries/Sin/KP предложить отдельно. Не переименовывать существующий HP в Stress и не подменять `character.level` значением CAT без миграционной политики. Это рекомендация подготовки; код адаптера здесь не менялся.

## 4. Общие document-поля и типы Actor

BOOT:129–135 регистрирует `character`, `sin`, `mundane`, `npc`, `opponent`. **`npc` — deprecated alias модели `sin`**, а не отдельный универсальный NPC со своей схемой. Тот факт, что часть sheet preparation проверяет только `type==='sin'`, требует отдельной будущей проверки legacy `npc` в runtime.

| Поле | Публичный путь | Тип / безопасный пример | Тип Actor | Хранение / динамика | Польза и границы | Источник |
| --- | --- | --- | --- | --- | --- | --- |
| Имя | `actor.name` | string, `Тестовый экзорцист` | Все | Document, обновляется | Заголовок | D:17–19, P:77 |
| Портрет | `actor.img` | string, `icons/svg/mystery-man.svg` | Все | Document, обновляется | Портрет после проверки пути/URL | D:15–31, P:78 |
| Prototype token image | `actor.prototypeToken.texture.src` | string, путь иконки | Все | Document, обновляется отдельно | Только явный выбор token portrait | D:26–29; `_preUpdate` синхронизация img закомментирована:60–65 |
| UUID / тип | `actor.uuid`, `actor.type` | string, `Actor.TEST`; `character` | Все | Document | Идентичность привязки; тип ветвления | BOOT:129–135; UUID — стандартный Document |
| Biography | `actor.system.biography` | string/HTML, `Тестовая биография` | Все; sin переопределяет default | Хранимое; редактируется | Только opt-in plain text, не сырой enriched HTML | B:18; S:62; SH:223–230 |
| Health current / max | `actor.system.health.value`, `.max` | integer, `10 / 10` | Все | Хранимое; value ≥0; max без min в B | Legacy/advanced ресурс, не объявлять основной механикой | B:10–13 |
| Power current / max | `actor.system.power.value`, `.max` | integer, `5 / 5` | Все | Хранимое; value ≥0; max без min | Legacy/advanced; не Psyche Bursts | B:14–17 |

Для `max<=0`, отсутствующего поля и недоступного Actor нельзя синтезировать «здоровый» индикатор. Путь portrait на prototype token не равнозначен текущему изображению любого Token на сцене.

## 5. Character — скалярные поля и счётчики

Здесь все пути начинаются с `actor.system.`. «Хр.» означает хранимое поле схемы; «Произв.» — runtime-подготовку. Примеры — допустимые тестовые значения, а не утверждение о значениях конкретного мира. `NumberField` не всегда имеет `integer:true`: значения finite надо проверять независимо от целочисленного вида счётчика в UI.

| Название | Путь | Тип, ограничение / пример | Хранение, обновление | Польза для overlay | Источник |
| --- | --- | --- | --- | --- | --- |
| CAT | `CATLEVEL.value` | number 0…7 / `3` | Хр.; выбирается листом | Основной ранг, badge | C:47–49; SH:2746–2755; TF:235 |
| Psyche | `psyche` | number ≥1 / CAT3 → `2` | **Произв.** `Math.ceil(CATLEVEL.value/2)||1`; также объявлено поле | Текущая сила психики, не независимый редактируемый ресурс | C:97–98,135–145 |
| Psyche Bursts | `psycheBurst.value` / `.max` | number 0…5 / `2 / 3` | Хр.; расходуется способностями, меняется листом | Основной расходуемый запас | C:100–103; SH:2728–2739,2942–3127 |
| Stress | `stress.value` / `.max` | number 0…15 / `2 / 6` | Хр.; текущий и предел меняются | Основной накопительный трек; рост неблагоприятен | C:63–66; SH:634–644; TF:323–324 |
| Injuries | `injuries.value` / `.max` | number 0…10 / `1 / 3` | Хр.; предел изменяемый | Раны, отдельный трек; не `max-health` | C:58–61; SH:647–657; TF:310–311 |
| Divine Agony | `divineAgony.value` / `.max` | number 0…10 / `1 / 3` | Хр.; расход/накопление на бросках | Основной ресурс; Pathos Tracker читает именно его | C:53–56; SH:2791–2809; P:79–80 |
| Sin Overflow | `sinOverflow.value` / `.max` / `.min` | number 0…20 / `4 / 10 / 0` | Хр.; порог также редактируется | Отдельная шкала риска, рост неблагоприятен | C:86–90; SH:612–626,1480–1493; TX:26–27 |
| Kit Points | `kitPoints.value` / `.max` | number 0…10 / `3 / 5` | Хр.; расход и предел редактируются | Снаряжение / доступный запас | C:92–95; SH:595–606,3194–3201; TX:31–32 |
| XP | `xp.value` / `.max` | number; value0…10, max4…10 / `2 / 4` | Хр.; достижение порога может обнулить XP и увеличить advancement | Прогресс, без трактовки как CAT | C:35–38; SH:2146–2182; TX:36–37 |
| Advancements | `advancements.value` / `.max` | number, max4 / `1 / 4` | Хр.; XP/конец сессии обновляют | Доступные advancement отметки | C:40–43; SH:2152–2153; TF:279–283 |
| Scrip | `scrip` | number 0…1000 / `12` | Хр.; ввод на листе | Валюта/число, opt-in | C:45; TP:42 |
| Extra d6 | `extraDice.value` | number 0…6 / `1` | Хр.; добавка к броску | Доп. строка, не базовый навык | C:68–70; TC:100,110 |
| Rest Dice Modifier | `restDiceModifier` | number −3…3 / `0` | Хр.; лист | Доп. статистика | C:105; TC:135–136 |
| Generic level | `attributes.level.value` | integer / `1` | Хр.; `getRollData().lvl` берёт это поле | Legacy, не CAT | C:10–14,148–159 |
| XID | `XID` | string / `TEST-001` | Хр., редактируется | Идентификатор персонажа по явному выбору | C:32; TC:54–56 |
| Agenda text | `agenda` | string / `Тестовая Agenda` | Хр.; свободный текст | Заголовок/подпись; не ID текущего Item | C:30; TC:40–42 |
| Blasphemy text | `blasphemy` | string / `Тестовая Blasphemy` | Хр.; свободный текст | Заголовок/подпись; не список powers | C:31; TC:47–49 |
| Внешность | `sex`, `height`, `weight`, `hair`, `eyes` | strings / `""`, `Тест` | Хр.; не numeric weight | Только opt-in текст | C:25–29 |
| Hide from tracker | `hideFromTracker` | boolean / `false` | Хр.; P исключает таких персонажей | Сигнал намерения пользователя; сам по себе не permission | C:129–130; P:73–74 |

XP не имеет единственного вычисляемого getter. Лист `_increaseXPValue` делает отдельные обновления XP и advancements. Окно [session-end-advancement.mjs:43](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/documents/session-end-advancement.mjs:43) считает gain и использует остаток/целое деление при нескольких advancements. Метод C:`handleXP()` не соответствует объектной структуре этих полей; его существование не доказывает работающую глобальную автоматику. Будущему адаптеру следует читать подготовленные значения, а не вызывать методы обработки XP.

### 5.1. Все десять нативных навыков CAIN

Actor type — только `character`. Каждый `system.skills.<key>.value` — required integer 0…4, default1; `.max` — integer0…4, default4. Это **dice rating**, не D&D ability score/modifier. Значение меняется через обычное обновление Actor. Источники: C:16–22 и CFG:109–120; [character-sheet.hbs:81](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/templates/actor/actor-character-sheet.hbs:81) отображает и использует эти значения.

| Название | Путь | Синтетический пример | Польза |
| --- | --- | --- | --- |
| Force | `actor.system.skills.force.value` / `.max` | `2 / 4` | Карточка навыков |
| Conditioning | `actor.system.skills.conditioning.value` / `.max` | `1 / 4` | Карточка навыков |
| Coordination | `actor.system.skills.coordination.value` / `.max` | `3 / 4` | Карточка навыков |
| Covert | `actor.system.skills.covert.value` / `.max` | `1 / 4` | Карточка навыков |
| Interfacing | `actor.system.skills.interfacing.value` / `.max` | `2 / 4` | Карточка навыков |
| Investigation | `actor.system.skills.investigation.value` / `.max` | `2 / 4` | Карточка навыков |
| Surveillance | `actor.system.skills.surveillance.value` / `.max` | `1 / 4` | Карточка навыков |
| Negotiation | `actor.system.skills.negotiation.value` / `.max` | `2 / 4` | Карточка навыков |
| Authority | `actor.system.skills.authority.value` / `.max` | `1 / 4` | Карточка навыков |
| Connection | `actor.system.skills.connection.value` / `.max` | `1 / 4` | Карточка навыков |

### 5.2. Коллекции Character и ссылки на Items

Все значения ниже хранимые и могут меняться. Сырые ID не являются названиями или текстом. Отсутствующий, удалённый либо недоступный Item должен давать unavailable/пропуск, а не доступ через GM-привилегии.

| Сущность | Путь | Форма / безопасный пример | Польза / особенности | Источник |
| --- | --- | --- | --- | --- |
| Текущая Agenda | `system.currentAgenda` | string ID / `"INVALID"` | Заголовок после разрешённого lookup; `INVALID` — отсутствие | C:110; SH:291–292 |
| Обычные Agenda tasks | `system.currentUnboldedAgendaTasks` | string[] / `[]` | Opt-in список задач | C:108; SH:293 |
| Bold Agenda tasks | `system.currentBoldedAgendaTasks` | string[] / `[]` | Отдельный список задач | C:107; SH:294 |
| Agenda abilities | `system.currentAgendaAbilities` | string[] / `[]` | Приобретённые способности | C:109; SH:295 |
| Blasphemies | `system.currentBlasphemies` | string[] world IDs / `[]` | Список родительских Blasphemy | C:112; SH:296,339–361 |
| Blasphemy powers | `system.currentBlasphemyPowers` | string[] **mixed embedded/world IDs** / `[]` | Сначала `actor.items.get(id)`, затем доступный world Item; сохранять персональные правки | C:113; SH:297,406–448 |
| Sin marks | `system.sinMarks` | string[] / `[]` | Фактический список, который читает текущий лист | C:115; SH:298 |
| Sin mark abilities | `system.sinMarkAbilities` | string[] / `[]` | Способности с bodyPartName | C:116; SH:299,316–335 |
| Legacy current marks | `system.currentSinMarks` | string[] / `[]` | В схеме есть, но текущая подготовка листа использует `sinMarks`; не объединять автоматически | C:84; SH:298 |
| Sin mark description | `system.sinMarkDescription` | string / `""` | Только явно выбранный текст | C:117 |
| Afflictions | `system.afflictions` | string[] Item IDs / `[]` | Названия/счётчик после permission-aware lookup; полные описания opt-in | C:51; SH:300 |
| Bonds | `system.bonds` | `{bondId:string,currentLevel:number0…3}[]` / `[]` | Уровень хранится **на Actor**, описание/способности — в world Bond Item | C:119–127; SH:374–394 |
| Character talismans | `system.talismans` | object[] / `[{name:"Execution",currMarkAmount:0,minMarkAmount:0,maxMarkAmount:6,imagePath:"systems/cain/assets/Talismans/Talisman-A-0.png"}]` | Локальные clock-треки; не global talismans | C:72–82; SH:2717,3205–3301 |

`talismans` объявлены через ArrayField/ObjectField; вложенные свойства дополнительно видны в default и обработчиках. Это не основание считать пользовательский объект строго типизированным: будущий normalizer должен проверять каждое поле и учитывать пустые/повреждённые записи.

Ссылки Agenda/Blasphemy/SinMark/Bond обычно ведут в world catalog Items. С версии, отражённой в локальном SH, powers копируются на конкретного Actor. `flags.cain.originWorldId` связывает embedded power с первоначальным world ID. Для группировки SH:`_getCharacterPowerByOrigin` сравнивает origin; брать всегда `game.items.get(id)` неправильно. Сами private sheet-методы вызывать из overlay не следует: семантику можно реализовать через публичные Document collections при будущем расширении.

## 6. Sin / legacy npc

Все пути — `actor.system.*`; поля хранимые, если не указано иное. Это сведения противника/расследования, многие из которых могут быть сюжетными секретами. Наличие поля в доступной схеме не означает согласие на вывод в эфир.

| Название | Путь | Тип / безопасный пример | Динамика и overlay | Источник |
| --- | --- | --- | --- | --- |
| Вид / форма | `sinType`, `sinForm` | string / `ogre`, `Form I/Severed` | Badge после явного выбора | S:11–12 |
| Категория | `category` | number ≥0 / `2` | Нативная категория Sin; другой путь, чем Character CAT | S:13 |
| Внутреннее изображение | `img` | string / системный путь | Не путать с `actor.img`; предпочтителен document portrait | S:10; D:18 |
| Современные Domains | `domainsV2` | string[] IDs / `[]` | Список связанных Domain Items | S:15–17; SH:463–483 |
| Legacy domains | `domains.ability1…ability8.title` / `.value` | strings / `Тестовый Domain`, `Тестовое описание` | Legacy custom text, не новый список Items | S:19–52 |
| Selected legacy abilities | `selectedAbilities.selectedAbility1…3` | strings / `""` | Служебный выбор legacy UI | S:54–58 |
| Palace / Appearance / Biography | `palace`, `appearance`, `biography` | string/HTML / `Тестовое описание` | Только явный opt-in без secret HTML | S:60–62; SH:196–230 |
| Trauma questions | `traumas[].question`, `.answered` | `{question:string,answered:boolean}[]` / `[{question:"Тестовый вопрос",answered:false}]` | Не равны Hunt discoveries; сюжетно чувствительные | S:64–71 |
| Pressure description | `pressure` | **string**, `Тестовое описание` | Это текст, **не числовой мировой Pressure clock** | S:73 |
| Complications / Threats | `complications`, `threats` | strings / `Тест` | Opt-in текст противника | S:75–76 |
| Обычная атака | `attackRoll.lowDamage`, `.mediumDamage`, `.highDamage`, `.rollFormula` | strings / `1`, `2`, `3`, `1d6` | Описательные/формульные строки; не готовый damage number | S:78–83 |
| Severe attack | `severeAttack.description`, `.rollFormula` | strings / `Тест`, `5d6` | Отдельное описание/формула | S:85–88 |
| Afflictions / severe questions | `afflictions`, `severeAbilityQuestions` | string[] / `[]` | Ссылки/списки, opt-in | S:91–92 |
| Selected talismans | `selectedTalismans` | object[] с name/imagePath/currMarkAmount/minMarkAmount/maxMarkAmount / `[]` | Лист подмешивает одноимённые global talismans, поэтому прямое чтение Actor может отставать от отображаемого clock | S:94–103; SH:270–279 |

S:`prepareDerivedData()` не вычисляет полноценные статистики по sinType. Лист `_onSinTypeSelect` содержит большие preset-структуры и операции записи; адаптер не должен вызывать этот обработчик для чтения. Числовой global Pressure и Execution надо рассматривать отдельно от текстовых полей Sin.

## 7. Mundane и Opponent

### Mundane

Actor type `mundane`; наследует B. В M:11–24 заданы хранимые `executionTalisman:number≥0` (пример `2`), `category:number0…7` (`1`), `complication:string`, `threats:string`, `description:string`, `rollData.roll1…roll6:string` (безопасно `""`). `prepareDerivedData` пустой. `executionTalisman` здесь **число**, а не объект со свойствами current/max. Не переиспользовать normalizer Opponent для Mundane без проверки типа.

### Opponent

Actor type `opponent`; наследует B. Основная модель — execution clock и **выдаваемый** stress, а не собственный Character stress.

| Название | Путь `actor.system.*` | Тип / пример | Хранение, динамика, overlay | Источник |
| --- | --- | --- | --- | --- |
| Вид / подвид | `opponentType`, `subType` | enum string / `human`; string / `Тест` | Хр.; заголовок. Вид: human/anomaly/sin-variant/exorcist/mechanical/drifter/pseudo-sin/binder | O:10–16 |
| CAT | `category` | integer0…7 / `2` | Хр.; ранг противника | O:18–19 |
| Execution marks | `executionTalisman.current` | integer≥0 / `1` | Хр.; основной clock | O:22–28 |
| Execution sizes | `executionTalisman.solo` / `.group` / `.horde` | integer0…20 / `2 / 4 / 6` | Хр.; варианты размера | O:23–25 |
| Active variant | `executionTalisman.useVariant` | solo/group/horde / `solo` | Хр.; определяет max | O:27 |
| Execution max | `executionTalisman.max` | number / `2` | **Произв.** `[variant] || solo`. При выбранном размере0 сработает fallback `solo`; не заменять это «улучшенной» формулой без отдельного решения | O:102–105 |
| Tags | `tags` | string[] / `["Тестовый тег"]` | Хр.; badges | O:30–33 |
| Range | `range` | melee/short/long/extreme / `melee` | Хр.; enum badge | O:35–40 |
| Stress outputs | `stressFormula.roll1`, `.roll2to3`, `.roll4plus` | **strings** / `4`, `3`, `2` | Хр.; выдаваемый stress по броску, не current/max персонажа | O:42–49 |
| Stress roll / bonus | `stressFormula.formula`, `.bonusEffect` | strings / `1d6`, `Тест` | Хр.; не исполнять формулу при чтении overlay | O:47–48 |
| Reactions | `reactions.attackWith`, `.stressAmount`, `.complication`, `.threat`, `.dieRoll` | strings / `Тест` | Хр.; компактная attack card только opt-in | O:60–67 |
| Special abilities | `specialAbilities[].name`, `.description`, `.trigger` | object[] / `[]` | Хр.; список с отдельной политикой текста | O:69–76 |
| Afflictions | `afflictions` | string[] Item IDs / `[]` | Хр.; потенциально inflicted list; не объявлять automatically current status | O:78–81; SH:398–403 |
| Capabilities | `capabilities` | string[] / `[]` | Хр.; opt-in текст | O:83–86 |
| Narrative | `description`, `tendencies`, `conditionalEffects`, `behavior`, `appearance` | strings / `Тест` | Хр.; opt-in, может быть секретом GM | O:51–58,88–90 |
| Pressure scaling metadata | `scalesWithPressure`, `pressureModifier` | boolean / `false`; string / `""` | Хр.; не подтверждён универсальный автоматический пересчёт всех Opponents | O:92–94 |
| Source | `source` | string / `Тестовый источник` | Хр.; подпись по выбору | O:96–97 |

## 8. Item-модели и полезные связи

Общие document-поля — `item.id`, `item.name`, `item.type`, `item.img`. Все зарегистрированные типы наследуют [base-item.mjs:9](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/base-item.mjs:9): `system.description:string`, `primaryColor`, `accentColor`, `secondaryColor`, `textColor:string`. Это данные контента/стиля, не параметры темы overlay. Безопасные примеры — вымышленные названия, пустые описания/списки и стандартные иконки.

| Тип Item | Специфические пути внутри `item.system` | Типы / синтетическая форма | Связь и значение | Локальный источник |
| --- | --- | --- | --- | --- |
| `item` | `quantity`, `weight`, `kitPoint`, `scripValue`, `type`, `roll.diceNum/diceSize/diceBonus`, `formula` | quantity integer≥1 /1; числа≥0 /0; strings /`Aesthetics`,`d6`,`""` | Embedded gear Actor; `formula` **производная** из roll, не исполнять | [item-item.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/item-item.mjs:10), derived:28–32 |
| `agenda` | `agendaName`, `unboldedTasks`, `boldedTasks`, `abilities`, `formula` | string /`Тест`; string[] /`[]` | Родитель с ID задач/способностей; Actor хранит свой выбор | [item-agenda.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/agenda/item-agenda.mjs:10) |
| `agendaTask` | `task`, `isBold`, `formula` | string /`Тест`; boolean /false | Текст задачи; не boolean completed | [item-agenda-task.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/agenda/item-agenda-task.mjs:10) |
| `agendaAbility` | `abilityName`, `abilityDescription`, `formula` | strings /`Тест`,`""` | Отдельный Item способности | [item-agenda-ability.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/agenda/item-agenda-ability.mjs:10) |
| `blasphemy` | `blasphemyName`, `powers`, `highBlasphemy` | string /`Тест`; string[] worldIDs /`[]`; nullable boolean /false | Родитель Powers; не список встроенных документов | [item-blasphemy.mjs:9](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/blasphemy/item-blasphemy.mjs:9) |
| `blasphemyPower` | `blasphemyType`, `powerName`, `isPassive`, `keywords`, `powerDescription`, `psycheBurstCost`, `psycheBurstNoCost`, `psycheBurstMultCost`, `isHighBlasphemy` | strings; keywords:string[]; остальные flags:boolean | Powers могут быть embedded. `psycheBurstCost` здесь **boolean**, не numeric cost; Quirk — keyword | [item-blasphemy-power.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/blasphemy/item-blasphemy-power.mjs:10) |
| `bond` | `virtueName`, `strictures`, `abilities`, `highBlasphemy`, `highBlasphemyLevel` | string; string[]; nullable string ID; integer0…3 /1 | Actor.bonds хранит currentLevel; parent хранит порог и связанные ability IDs | [item-bond.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/bond/item-bond.mjs:10) |
| `bondAbility` | `bondLevel`, `abilityDescription`, `isPermanent`, `requiresPsycheBurst`, `psycheBurstCost` | integer0…3 /0; string; booleans; integer≥0 /0 | Cost здесь **number**: 0 значит все оставшиеся в описанной модели; не путать с одноимённым boolean у Power | [item-bond-ability.mjs:12](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/bond/item-bond-ability.mjs:12) |
| `sinMark` | `bodyPartName`, `markAmount`, `abilities` | string; number0…10 /0; string[] IDs /`[]` | Mark и дочерние способности | [item-sin-mark.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/sins/item-sin-mark.mjs:10) |
| `sinMarkAbility` | `abilityName`, `abilityDescription`, `bodyPartName`, `formula` | strings /`Тест`,`""` | Способность с локализацией на теле | [item-sin-mark-ability.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/sins/item-sin-mark-ability.mjs:10) |
| `affliction` | `afflictionName`, `afflictionDescription`, `formula` | strings /`Тест`,`""` | Actor хранит ссылку, не копирует полный текст в scalar | [item-affliction.mjs:10](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/afflictions/item-affliction.mjs:10) |
| `domain` | `sinSource`, `domainDescription`, `selectsExorcist`, `afflictionEffect` | string /`ogre`; string; boolean /false; nullable string /`""` | Sin.domainsV2 → Item; это не Character power | [item-domain.mjs:8](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/domains/item-domain.mjs:8) |

Экспорты `CainSpell`, `CainFeature`, `CainSins` присутствуют в `_module.mjs`, однако BOOT:137–150 не регистрирует типы spell/feature/sins. Например, `item-spell.mjs` содержит `spellLevel`, но это **не подтверждённое поле актуального зарегистрированного CAIN Item**. Не включать его в пользовательский каталог по факту существования файла.

## 9. Hunt Tracker и global clocks — другой источник данных

Это мировые настройки, а не поля выбранного Character. Их нельзя искусственно поместить под произвольный `actor.system.*`. Ни одна настройка мира для исследования не читалась: ниже — формы из registration/default и кода записи.

| Источник | Путь чтения / поля | Тип / синтетический пример | Производность и ограничение | Источник |
| --- | --- | --- | --- | --- |
| Hunt state | `game.settings.get('cain','currentHunt')` | object | World scope, config:false; не признак публичности | BOOT:386–410 |
| Identifiers | `.active`, `.sinActorId`, `.sinName`, `.sinType`, `.sinCategory` | bool/string/null/number / false,null,`""`,`""`,0 | При старте берётся snapshot Sin name/type/category; изменения Actor не обязательно обновляют его автоматически | BOOT:392–396; H:779–786 |
| Tension | `.tension.current`, `.max`, `.sceneRiskTriggered` | number/number/bool /0,3,false | Изменяется сценами/риском; отдельный clock | BOOT:397; H:1232–1258 |
| Pressure | `.pressure.current`, `.max`, `.outOfControl` | number/number/bool /0,6,false | Числовой мировой трек, не Sin.system.pressure | BOOT:398; H:1290–1316 |
| Execution | `.execution.current`, `.base`, `.calculated` | numbers /0,8,10 | Во время hunt рассчитывается 8+pressure+sinCategory. Registration default base/calculated6; не применять default6 как правило активной охоты | BOOT:399; H:789–792,1216–1229 |
| Trauma discoveries | `.traumas[].question/answer/discovered/used` | string/string/bool/bool /`Тест`,`""`,false,false | Не тождественно Sin.traumas[].answered; секреты раскрытия | H:794–799 |
| Phase / scene / palace | `.phase`, `.sceneCount`, `.insidePalace` | string/number/bool /briefing,0,false | Текущее состояние охоты, возможен overlay только по отдельному opt-in | BOOT:403–405 |
| Notes / custom clocks | `.notes`, `.customTalismans` | string/array /`""`,`[]` | Нельзя автоматически транслировать GM notes | BOOT:401–402 |
| Global talismans | `game.settings.get('cain','globalTalismans')[]` | `{name,imagePath,currMarkAmount,minMarkAmount,maxMarkAmount,isHidden}` | Отдельный массив; индексы и имена могут меняться. `isHidden` надо учитывать как пользовательское сокрытие | BOOT:177–207 |
| Linked clocks | `currentHunt.linkedTalismanIndex`, `.linkedTensionTalismanIndex`, `.linkedPressureTalismanIndex` | index/null | Связь по индексу массива, не stable document UUID | H:291–317,1219–1225 |

`HuntTracker._getExecutionMax()` возвращает linked global max, если связь действительна, иначе формулу; при неактивной охоте возвращает8. Это private метод приложения, не публичный data API. Будущая нормализация должна документировать самостоятельное правило и источники, а не вызывать UI. При изменении Pressure код обновляет `execution.calculated` и linked maximum; global и hunt синхронизируются в обе стороны (BOOT:33–85; H:1290–1384).

`huntTrackerPrivateMessages` (BOOT:218–224; H:13–23) управляет **whisper сообщений**, а не автоматическим ACL для всего `currentHunt`. Отсюда не следует, что доступный клиенту world setting безопасно целиком отдавать в OBS. Необходим отдельный явный выбор разрешённых clock-полей; notes/ответы на trauma/нераскрытые детали не включать по умолчанию.

## 10. Подготовка данных, обновления и безопасные точки интеграции

1. **Читать текущий `actor.system` после data preparation.** C:`prepareDerivedData` пересчитывает Psyche; O вычисляет execution max; Item `item` пересчитывает formula. `_source`/сериализация до подготовки может не содержать актуальные derived значения.
2. **Не использовать `sheet.getData()` как data API.** SH:174–283 обогащает HTML с `secrets:this.document.isOwner`, разрешает Items и добавляет мировой контекст. Это UI context, не permission-filtered payload для вещателя. Полные `toPlainObject()` в D:86–98 и [base-model.mjs:11](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/base-model.mjs:11) также слишком широкие: Actor включает items/effects и личные поля.
3. **Actor updates могут приходить несколькими последовательными операциями.** Лист изменяет счётчики через `actor.update`, в том числе XP и advancements отдельно (SH:2146–2155); общая `updateActor` на SH:3743–3747 — UI helper, не обязательная публичная точка изменения. Будущий normalizer должен переживать промежуточное состояние и коалесцировать повторные invalidation.
4. **Изменение Item тоже меняет отображаемое содержимое.** Power может быть embedded или world catalog; добавление/удаление создаёт/удаляет embedded документы и меняет массив Actor. Удаление world Item может оставить неразрешимую ссылку. Для будущего расширения потребуются public create/update/deleteItem events с обратным индексом Actor references; для embedded Item — parent Actor. Не запускать миграцию `_embedPowerForActor` ради чтения.
5. **Active Effects следует читать как подготовленные значения.** BOOT:154–157 отключает legacy transferral и допускает transferred Item effects. Document предоставляет `allApplicableEffects()` (SH:264–266). Подписки на Actor, embedded/world Item и ActiveEffect должны учитывать изменения, если новые поля допускают effects. Это предложение тестирования, не результат live-проверки effect-механик.
6. **Мировые clock updates не равны `updateActor`.** Hunt/Global используют `game.settings.set` и socket `system.cain`. Будущая интеграция должна наблюдать публичное изменение соответствующей Setting и перечитывать разрешённые поля. Private `_emitUpdate`/UI redraw не являются необходимой зависимостью overlay.
7. **Psyche, current/max и текст — разные типы.** Не исполнять формулы, не вызывать roll(), handleXP(), sheet handlers, `_preCreate`/`_preUpdate` или migration helpers при чтении. Не публиковать код/выражения из настроек.
8. **Права проверять под OBS viewer.** Permission выбранного Actor, доступность связанных Items и выбранных полей должны проверяться до разрешения и после async-read. Потеря права, удалённая ссылка и unsupported Actor type → unavailable, не GM fallback. Данные, которые владелец видит через enriched secrets, не равнозначны данным OBS viewer.

## 11. Приоритет будущей Phase 6 и ограничения аудита

**Первый кандидат:** Character CAT, derived Psyche, Psyche Bursts, Stress, Injuries, Divine Agony, Sin Overflow, Kit Points, XP/Advancements, Scrip и десять навыков. Это небольшие typed scalar/current-max значения; ни полное Actor serialization, ни доступ к компендиям для них не нужны.

**Второй кандидат:** явные permission-aware списки названий Afflictions/Agenda/Blasphemies/Bonds и clock из выбранного Talisman. Требуются mixed Item reference resolution, зависимость от Item updates и стабильная политика unavailable. Actor.bonds.currentLevel — собственное значение персонажа, не поле общего Bond Item.

**Отдельный будущий scope:** Sin/Opponent presentation и мировые Hunt/Global clocks. Не смешивать их с Character resources и не включать GM narrative/trauma по умолчанию. Portrait, имя и разрешённые counters можно рассматривать независимо от полного текста врага.

Не установлено чтением схемы: фактическое содержимое Actors пользователя, custom flags/модули и домашние правила, наличие world catalog Item с конкретным ID, поведение всех Active Effects, права конкретного OBS viewer, live-порядок хуков в установленном мире и корректность всех legacy `npc`/старых коллекций. Эти данные намеренно не запрашивались из world DB. Миграции, создание тестовых документов и запуск системных обработчиков не выполнялись.

Итог подготовки: проверенная схема и неодинаковая семантика одинаковых имён описаны; реализация новых полей, подписок, списка контента и UI остаётся за пределами этого документа.
