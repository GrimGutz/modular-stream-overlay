# Phase 6 — итог подготовки и план на утверждение

Дата исследования: **21 октября 2026 года**. Модуль: **modular-stream-overlay 0.5.5**, установленная рабочая директория: `C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay`.

**Статус: Git подготовлен; аудит и исследование завершены; функциональная реализация Phase 6 не начата.** Согласно разделу Strict Approval Gate исходного запроса, следующий шаг требует одобрения этого плана. Проверенные свойства текущего кода и предлагаемые изменения ниже разделены.

Подробные приложения:

- [Аудит архитектуры](PHASE6_ARCHITECTURE_AUDIT_RU.md).
- [Полная карта CAIN: схемы, типы, примеры, происхождение, Items и обновления](PHASE6_CAIN_FIELD_MAP_RU.md).
- [D&D5e: установленная 5.3.3 и сравнение с 6.0.6](PHASE6_DND5E_RESEARCH_RU.md).

## 1. Git: что сохранено и что остаётся сделать

Активная установка подтверждена `dataPath: C:/Users/Lev/AppData/Local/FoundryVTT` в конфигурации Foundry и manifest модуля с ID `modular-stream-overlay`, версией 0.5.5 и совместимостью v14. Дубликат проекта не создавался. Репозитория в этом каталоге и родительских каталогах до подготовки не было.

Создан локальный репозиторий, ветка **main**. Базовый коммит:

- **`0e32ed6154dd9f048882f7437e72f3d100985075`** (`0e32ed6`).
- Сообщение: `chore: establish stable pre-phase-6 baseline`.
- Тег: **`pre-phase-6-stable-v0.5.5`**, указывает на этот коммит.
- 99 файлов: рабочие исходники, тесты, инструменты, предшествующая документация и три поставляемых SVG. Существующие исправления анимаций включены в baseline.
- Использована уже настроенная Git identity. Глобальная конфигурация не менялась; старой истории для перезаписи не было.

`.gitignore` исключает `storage/`, `work/`, пользовательские изображения в `assets/`, миры/базы, настройки Foundry, зависимости, сборки, кэши, секреты и временные файлы. Явно сохранены `basic-background.svg`, `demo-mage.svg`, `demo-warrior.svg`. `.gitattributes` содержит `* -text`, чтобы начальный коммит сохранил существующие смешанные переводы строк без массовой нормализации. Поиск типичных сигнатур ключей/токенов в включаемом исходном дереве совпадений не показал; это ограниченная проверка, не доказательство отсутствия любых секретов.

Документы Phase 6 подготовлены для отдельного локального коммита `docs: record phase 6 research and implementation plan`. Его SHA доступен через `git log -1 --oneline` и в итоговом сообщении. Стабильный тег остаётся на baseline. Разница с baseline должна содержать только четыре документа `docs/PHASE6*.md`.

Это резервная точка **исходного кода**, а не копия состояния мира: настройки оверлеев, пресеты в мире, Actors и пользовательские изображения намеренно не включены. Для них нужна обычная резервная копия Foundry user data. Для будущего отката следует просмотреть изменения и выборочно восстановить нужные исходники из тега; `reset --hard`, удаление каталогов и подмена пользовательских данных не требуются.

**GitHub:** remote отсутствует, код не опубликован. GitHub CLI в окружении не найден. После отдельного явного разрешения на публикацию останется:

1. Утвердить GitHub owner и имя, создать **private**, пустой репозиторий без начального README/license/gitignore.
2. Повторно просмотреть `git ls-files` и diff, подтвердить состав публикуемых материалов и права на поставляемые ресурсы.
3. Выполнить `git remote add origin <утверждённый-SSH-или-HTTPS-URL>` с обычной аутентификацией Git, без токена в URL.
4. Выполнить `git push -u origin main` и отдельно `git push origin pre-phase-6-stable-v0.5.5`.
5. Проверить private visibility, SHA и тег на GitHub. Force push не нужен.

Эти сетевые операции в подготовке не выполнялись.

## 2. Проверенная архитектура и ограничения

Данные проходят через `AdapterRegistry → CharacterDataService → flat character.* values → bindings → components / TriggerRuntime / carousels`. Системные пути отделены от дизайна. Preset хранит binding IDs; widget instance хранит назначение одного или нескольких Actor. Поэтому расширение каталога полей не требует переписывания визуального дизайна.

| Область | Проверенный результат | Следствие для Phase 6 |
| --- | --- | --- |
| Адаптеры | Зарегистрированы generic и CAIN. Публичный `api.registerAdapter()` доступен внешним модулям. Выбираются generic и первый адаптер с текущим `game.system.id`. | Нужны диагностика конфликтов и явный выбор provider. |
| Контракт | `{id,label,systemId,fields,normalize}`; types — number/string/image; результат — flat scalars. | Достаточно для основного CAIN; metadata надо расширять совместимо. |
| UUID и права | Только world Actor; Observer до чтения и после async normalization, под viewer вывода. | Не добавлять compendium/synthetic Token поддержку скрыто. |
| Обновления | Actor, embedded Item/ActiveEffect, linked Token и viewer User; debounce; повторные чтения потребителей. | Для scalar CAIN основы есть. World Item references требуют явных зависимостей. |
| Виджеты | Text/template, portrait, numeric interpolation и current/max bar; eligibility основана на scalars. | Сырые массивы/Items в renderer не передавать. |
| Ошибки | `{values,warning}`; нет подробного статуса поля, applicability или версий. | Добавить status sidecar, сохранив values/null. |
| Mappings | До64 world mappings, number/string, ограниченный `system.*`, без JS; нет scope. | Нужны scope и preview, без обхода всего Actor. |
| Ограничения | До 128 полей адаптера/одного resolve; нет общего snapshot/cache. | Держать каталог ниже лимита. Кэш — только после измерений. |
| OBS | Клиент `/stream?mso=1` нормализует доступные Foundry Documents локально. Module socket передаёт команды, без Actor values. | Сохранить pipeline и viewer permissions. Новый data proxy не нужен. |

Проверенный код: [registry.js:58](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/core/registry.js:58), [character-data.js:54](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/data/character-data.js:54), [bindings.js:12](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/data/bindings.js:12), [character-components.js:161](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/render/character-components.js:161), [actor-carousel.js:29](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/render/actor-carousel.js:29), [transport.js:6](C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay/scripts/animation/transport.js:6).

Важные ограничения: сохранённый `overlay.adapter.id/config` сейчас не управляет выбором CharacterDataService; `maxField` проверяется синтаксически, но не проверяется его числовая цель; metadata format не является работающим универсальным formatter; boolean допускается TriggerRuntime, но не проходит registry/service end-to-end. Реестр JS-адаптеров не является sandbox для недоверенного кода.

## 3. CAIN — главный результат исследования

Установлена **CAIN 1.3.26**, minimum Foundry 11, verified/maximum 14. Модели регистрируют `character`, `sin`, `mundane`, `opponent` и deprecated `npc` как alias Sin. Схемы TypeDataModel и используемые листом поля изучены локально. Шесть ключевых файлов совпадают по нормализованному тексту с официальным тегом **v1.3.26**, commit релиза **fbd0eca**; полная идентичность установленного архива не заявляется. Hashes приведены в карте CAIN.

Сокращённая карта первого набора: все строки применимы к `character`, могут изменяться при обновлении Actor; примеры синтетические. Полные типы, ограничения, остальные Actor/Item модели и источники каждой строки приведены в приложении.

| Поле | Путь на подготовленном Actor | Тип / пример | Хранение | Предлагаемый binding |
| --- | --- | --- | --- | --- |
| CAT | `system.CATLEVEL.value` | number /3 | Хранимое | `character.cain.cat` |
| Psyche | `system.psyche` | number /2 при CAT3 | Производное: `ceil(CAT/2) || 1` | Существующий `character.psyche` |
| Stress | `system.stress.value/max` | number /2,6 | Хранимое | Существующие `character.stress.current/max` |
| Psyche Bursts | `system.psycheBurst.value/max` | number /2,3 | Хранимое | `character.cain.psycheBurst.current/max` |
| Injuries | `system.injuries.value/max` | number /1,3 | Хранимое | `character.cain.injuries.current/max` |
| Divine Agony | `system.divineAgony.value/max` | number /1,3 | Хранимое | `character.cain.divineAgony.current/max` |
| Sin Overflow | `system.sinOverflow.value/max/min` | number /4,10,0 | Хранимое | `character.cain.sinOverflow.current/max/min` |
| Kit Points | `system.kitPoints.value/max` | number /3,5 | Хранимое | `character.cain.kitPoints.current/max` |
| XP | `system.xp.value/max` | number /2,4 | Хранимое | `character.cain.xp.current/max` |
| Advancements | `system.advancements.value/max` | number /1,4 | Хранимое | `character.cain.advancements.current/max` |
| Scrip | `system.scrip` | number /12 | Хранимое | `character.cain.scrip` |
| Десять навыков | `system.skills.<key>.value/max` | integer /2,4 | Хранимое | `character.cain.skills.<key>.rating/max` |
| Extra d6 / rest modifier | `system.extraDice.value`, `system.restDiceModifier` | number /1,0 | Хранимое | `character.cain.extraDice`, `character.cain.restDiceModifier` |
| XID, Agenda, Blasphemy | `system.XID`, `.agenda`, `.blasphemy` | string /TEST-001,Тест | Хранимое | `character.cain.xid/agenda/blasphemy` |
| Внешность по явному выбору | `system.sex/height/weight/hair/eyes` | string /Тест | Хранимое | `character.cain.appearance.sex/height/weight/hair/eyes` |

Запись `/max` сокращает несколько отдельных scalar IDs, а не обозначает допустимый символ binding. Навыки: force, conditioning, coordination, covert, interfacing, investigation, surveillance, negotiation, authority, connection. Пример полного ID: `character.cain.skills.force.rating`; глубина соответствует нынешнему validator. Проверены 56 предлагаемых CAIN IDs, включая legacy и пять appearance полей: валидны и уникальны. Вместе с пятью generic полями и максимально 64 mappings получается 125 — ниже лимита 128. Добавление дальнейших projections потребует повторной проверки бюджета и batching.

Источники: [actor-character.mjs:35](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/actor-character.mjs:35), [производная Psyche:135](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/data/actor-character.mjs:135), [config.mjs:109](C:/Users/Lev/AppData/Local/FoundryVTT/Data/systems/cain/module/helpers/config.mjs:109), [официальная Character-модель v1.3.26](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/actor-character.mjs).

**Не смешивать семантику:** `system.health`, `system.power` и `system.attributes.level.value` существуют как legacy/general поля. Это не основания считать их основными HP, Psyche Bursts и CAT. Нынешние `character.hp.*`, `character.power.*`, `character.level` сохраняют старые пути. D&D-style abilities в Character schema CAIN не определены; остаточный код не считается подтверждением характеристик.

**Связанные документы:** Character хранит ID Agenda/Blasphemy/Affliction/SinMark/Bond; Powers бывают embedded и legacy world Items. У Bond currentLevel находится на Actor. `psycheBurstCost` у Power — boolean, у BondAbility — number. Talismans — массив объектов без подтверждённого стабильного ID. Нельзя превращать ID в название без разрешённого lookup или выбирать мировой Item вместо персонального embedded power.

**Границы первого выпуска:** все перечисленные numeric поля/пары и opt-in короткие строки XID/Agenda/Blasphemy/внешности. Raw collections, descriptions, biography и GM secrets не входят в автоматический каталог. Названия связанных способностей/состояний, выбор talisman, presentation Sin/Opponent и мировые Hunt clocks — последующее расширение после согласования контракта коллекций и permissions. Исследование структур выполнено, но scalar MVP не объявляется их полной поддержкой. Это осознанная граница предлагаемого плана для утверждения.

## 4. D&D5e — вторичная цель

Установлена **5.3.3**, minimum Foundry 13.347, verified 14. Изучены локальный объединённый код и sourcesContent source map, выбранные структуры сверены с официальным `release-5.3.3`. В официальном latest на дату проверки — **6.0.6**, minimum 14.367, verified 14. Это отдельная цель проверки, а не уже поддержанная версия.

Первый адаптер ограничить `character`: generic identity/portrait; HP current = подготовленный `attributes.hp.value`, знаменатель = `attributes.hp.effectiveMax` с tempmax; temp HP отдельно; AC = `attributes.ac.value`; уровень = подготовленный `details.level`; шесть ability score/modifier; три именованных ресурса primary/secondary/tertiary. Последние — пользовательские слоты, а не универсальная «мана».

В 6.0 изменены источники AC и exhaustion; читать подготовленные значения, не повторять формулы и не читать старые private flags. Для NPC legendary resources используются `spent/max`; CR не равен уровню PC. NPC, vehicle, group, encounter, spell slots, item uses и UI условий отложены. Публичный `Actor.statuses` пригоден для будущей scalar summary, но Set/boolean нельзя передавать в нынешний renderer.

Источники: [HP/AC5.3.3](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/templates/attributes.mjs), [Character5.3.3](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/character.mjs), [HP/AC6.0.6](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/actor/templates/attributes.mjs). Поддержку 6.x объявлять только после отдельных fixtures и runtime acceptance; обновление установленной системы не требуется этим планом.

## 5. Предлагаемый универсальный контракт

Это **проект интерфейса**, ещё не существующий API. Сохраняются `normalize(actor,{user,fields,portraitSource}) → flat values`, `fieldDefinitions()` и `resolve() → {values,warning}`. Объекты Documents, system paths и HTML не становятся значениями bindings. Системные пути живут только в адаптерах и явно настроенных advanced mappings.

### 5.1. Совместимые дополнения

| Уровень | Предлагаемое дополнение | Правило |
| --- | --- | --- |
| Adapter | `interfaceVersion:1`, `actorTypes`, `testedSystemVersions` | Старый descriptor без metadata остаётся v1. Версии подтверждаются явно, первоначально CAIN 1.3.26 и D&D5e 5.3.3. |
| Field | `group`, `actorTypes`, `testedSystemVersions`, `unit`, `role`, текущие `maxField`/`format` | Только whitelist и bounded strings/enums; поля текущего v1 не теряются. Metadata не выполняет код. |
| Resource | `resources:[{id,label,currentField,maxField,polarity}]` | Ссылки ведут на numeric descriptors; polarity lower-is-worse/higher-is-worse/neutral задаётся подтверждённой семантикой. |
| Result | Дополнительные `status`, `fieldStatus` | available, unsupported-field, unsupported-actor-type, unverified-version, unavailable. Старые callers читают values/warning; известное недоступное значение — null. |
| Provider | `getAdapterPreferences()` в service, world setting systemId→adapterId | Явный выбор побеждает auto. Совместимый auto сохраняет первый matching adapter и показывает конфликт; все кандидаты одновременно не запускаются. |
| Changes | Optional trusted `affectsChange(event,{actor,document,changes})` | Boolean callback через общий service; event names ограничены публичными document hooks. Нет per-widget watchers и произвольных network reads. |

Точные signatures optional callback проверяются контрактными тестами до использования. Ошибка callback превращается в безопасное unavailable/диагностику, без Actor dump. `normalize` остаётся обязательным для внешних v1 callers. Статусы missing и invalid допускается объединить в unavailable: нельзя обещать различение причин, если legacy normalize уже вернул null.

Для provider setting default — пустой map; в auto существующее поведение сохраняется. Явно выбранный отсутствующий provider, несовпадающий systemId или неподдержанный interfaceVersion даёт предупреждение и generic identity, без молчаливой замены другим system adapter. Активировать существующий `overlay.adapter.id` скрыто не предлагается. Третья сторона регистрирует adapter через прежний API и может быть выбрана явно; композиция нескольких system providers отложена.

Applicability задаётся также **на поле**: native CAIN поля доступны character; существующие legacy CAIN чтения сохраняются на прежних типах, где значения фактически есть. Для новых полей вне проверенной версии — unverified-version и недоступное системное значение; generic identity остаётся. Adapter-level testedSystemVersions описывает результаты проверки, а не блокирует provider целиком. Строгая версия задаётся на новых field descriptors через testedSystemVersions; отсутствие field-level ограничения сохраняет legacy чтение. Legacy IDs не получают новую строгую блокировку незаметно. Каталог объясняет различия. Адаптер целиком не должен быть запрещён actorTypes, если в нём есть старые поля с более широкой применимостью.

### 5.2. Ресурсы, discovery и mappings

Каталог формируется из generic + выбранного адаптера + применимых mappings. UI показывает группы, подписи, тип, ресурсную пару и доступность под текущим Actor/viewer. Unknown binding остаётся в preset. При выборе current поле maximum можно предложить автоматически, не перезаписывая явно выбранный maxBinding. Metadata не меняет размеры, цвета и дизайн.

Существующих числовых компонентов/полос достаточно для CAIN. Clock-сегменты и Roman CAT — необязательные улучшения; они не задерживают чтение данных. `format` нельзя объявлять работающим formatter до явной реализации. Первый выпуск использует обычные числа/текст и существующие настройки отображения.

Advanced mappings остаются декларативными: ID, label, number/string, path. Добавить optional `systemId`, `actorTypes`, `testedSystemVersions`, numeric `maxField`. Сохранить лимиты и denylist, запрет функций, expressions, prototype/flags/notes/биографии и обхода документов. Plain-text preview показывает только выбранное разрешённое scalar значение; схема разрешённого пути не доказывает публичность произвольного поля.

Старые записи без scope сохраняются как legacy-global с видимым предупреждением. Они продолжают работать; автоматическая привязка к текущей системе или переписывание путей не выполняется. Пользователь может явно добавить scope. Приоритет: generic → выбранный system adapter → явный mapping → допустимые derived values. Явный mapping HP percent сохраняет нынешний приоритет над автоматическим процентом. Identity IDs остаются защищёнными.

Производные значения вводить только как известные операции с dependencies, не формулы из строк. В этой фазе достаточно сохранить нынешний HP percent и читать Psyche уже подготовленной системой. Универсальный DAG вычислений и кэш не являются условием CAIN. Будущее объединение reads должно учитывать viewer, права, Actor, system/provider и mappings revision; отзыв прав немедленно очищает результат.

### 5.3. Совместимость и миграции

Изменения аддитивны. Для новых bindings миграция preset не нужна; текущие overlay schema 6 / preset schema 4 продолжают работать. Scope metadata mappings должна проходить новый validator с загрузкой старой формы. Если потребуется изменение saved schema, его нужно описать и подтвердить round-trip fixtures **до записи**; bump «на всякий случай» не нужен.

Не менять смысл `character.level`, health/power и единицы values; не переводить stress в остаточное здоровье. Не переименовывать UUID/Actor assignments и не сбрасывать пресеты/demo. Unknown поля переживают импорт/сохранение без потери. Изменения мировых Actor/Item схем, миграции CAIN Powers и перенос изображений не нужны.

## 6. Предлагаемый пользовательский сценарий CAIN

1. Создать reusable preset, добавить существующие portrait/text/numeric/resource-bar компоненты.
2. Выбрать группу CAIN и поле по подписи, например Stress; для полосы предложить Stress maximum. Для CAT выбрать число, для Psyche Bursts — current/max.
3. Настроить цвета/размер/подписи и анимации; сохранить preset без назначения конкретного персонажа.
4. Добавить instance в overlay, назначить доступный world CAIN Character. Поля заполняются по UUID под правами Player вывода.
5. При обновлении Actor данные перечитываются, существующие DOM-компоненты обновляются, правила сравнивают значения того же binding.
6. Назначить список Characters и включить existing combined page/character cycling. Страница без поддерживаемых значений пропускается по нынешней политике; неизвестные binding не удаляются.
7. Повторно использовать preset для другого персонажа. Потеря права очищает значения и показывает причину, без GM fallback или выдуманных нулей.

## 7. Milestones и критерии приёмки

### Phase 6.1 — Adapter Architecture

**Цель:** совместимое расширение metadata, выбора provider, availability и scope mappings, без переписывания renderer. **Зависимость:** одобрение плана и baseline tag.

**Ожидаемые файлы:** `scripts/core/registry.js`, `scripts/data/character-data.js`, `scripts/data/mappings.js`, `scripts/main.js`, локальные участки selectors в `scripts/ui/editor.js` и `scripts/ui/widget-editor.js`; новые `tests/adapter-contract.test.js`, дополнения `tests/core.test.js`, `tests/data.test.js`, `tests/widget-editor.test.js`, `docs/EXTENDING.md`. Bindings/schema — только если контрактный тест докажет необходимость, без ослабления ID syntax.

**Шаги:** закрепить fixtures v1; валидировать optional metadata/resource targets; добавить statuses; provider preference с совместимым auto/диагностикой; scoped mapping preview; подключить каталог к текущим controls. Сохранить requested-fields limit и chunking.

**Риски:** отбрасывание metadata реестром, смена provider, потеря legacy mappings, permission leak в preview, несовпадение type/max. **Приёмка:** прежние adapters/пресеты дают прежние IDs/значения; generic fallback работает; конфликты видны; явный provider используется; неизвестный binding сохранён и отсутствует в values, известное недоступное поле равно null; UI не предлагает несовместимую max пару.

**Тесты:** старый adapter без metadata, duplicate IDs/providers, explicit provider failure, version/type guards, invalid resource target, bounds/invalid input, global mappings и scope, override HP percentage, permission revoke во время async read, unknown-system/unknown-binding.

### Phase 6.2 — CAIN Integration — приоритет

**Цель:** полный первый набор проверенных scalar Character полей раздела 3, с native current/max semantics, обновлениями и статусами. **Зависимость:** 6.1 и source map CAIN 1.3.26. D&D5e не блокирует работу.

**Ожидаемые файлы:** `scripts/adapters/cain.js`, при необходимости `scripts/adapters/cain-fields.js`, `tests/cain-adapter.test.js`, синтетические `tests/fixtures/cain-1.3.26.js`, дополнения data/character-renderer tests, новый `docs/CAIN.md`. В shared core не добавлять CAIN paths.

**Шаги:** сохранить девять текущих descriptors/семантику; добавить CAT, Bursts, Injuries, Agony, Overflow, KP, XP/Advancements, Scrip, ten skills, остальные scalars и явно выбираемые короткие строки; resource metadata связывает поля. Psyche читать после preparation. Проверять finite/type, не преобразовывать строки в числа. Определить applicability. Использовать existing Actor/embedded events; не вызывать sheet/getRollData/roll/XP обработчики. Native поля показать первыми, legacy — отдельной группой.

**Риски:** boilerplate вместо механики, путаница одноимённых Item полей, max0, подготовленная Psyche, промежуточные XP updates. **Приёмка:** каждый ID имеет source/fixture; CAT не равен generic level; Bursts не равны power; рост Stress не называется HP damage; старые bindings сохраняют значения; unsupported types не получают выдуманные native поля. Нет Actor mutations и утечки коллекций/описаний.

**Тесты:** CAT0/1/3/7 и подготовленная Psyche, все skills, current/max0/отсутствует/NaN/выше порога, строки, partial legacy Actor, type/version mismatch, requested fields only, Observer/revoke, read-only сверка доступного Character. Синтетические fixtures содержат ожидаемую подготовленную Psyche; production adapter не повторяет системную формулу вместо чтения.

### Phase 6.3 — CAIN Demonstration Presets

**Цель:** opt-in примеры именно CAIN на существующих компонентах/carousel. **Зависимость:** 6.2 принят; IDs стабильны.

**Ожидаемые файлы:** новый `scripts/demo/cain.js`, подключение в `scripts/demo/install.js`/`scripts/demo/identities.js`, при необходимости `scripts/demo/data.js`; `tests/cain-demo.test.js`, дополнения demo/combined renderer tests; `DEMO_GUIDE.md`, `docs/CAIN.md`. Не менять текущие demo IDs/пользовательский JPEG.

**Шаги:** компактная identity/CAT/Psyche карточка; страница Stress/Injuries/Divine Agony; страница Bursts/KP/Overflow, дополнительная skills/progression. Preset хранит bindings, instance — Actor list. Установка явной командой пользователя, без автоназначения реальных Actors. Использовать поставляемую иконку/фон или текущую тему. Новые специализированные компоненты не обязательны.

**Риски:** reset пресетов, layout при missing data, ложные триггеры при Actor смене, много страниц. **Приёмка:** один preset работает с двумя Characters; export/import сохраняет bindings/оформление; combined traversal проходит страницы/Actors; unavailable страницы корректно пропускаются; установка повторяема без перезаписи существующего.

**Тесты:** opt-in/idempotence, отсутствие Actor writes, schema, persistence, отдельные histories, repeated cycling, missing fields, DOM patch/cleanup, Fade/Pulse без смены дизайна.

### Phase 6.4 — D&D5e Integration

**Цель:** независимый PC адаптер после CAIN. **Зависимость:** 6.1–6.3 приняты; установленная5.3.3 — основная точка проверки.

**Ожидаемые файлы:** новый `scripts/adapters/dnd5e.js`, регистрация `scripts/main.js`, `tests/dnd5e-adapter.test.js`, синтетические `tests/fixtures/dnd5e-5.3.3.js`/`dnd5e-6.0.6.js`, `docs/DND5E.md`. Renderer/animation core не требуют D&D paths.

**Шаги:** identity generic; HP/effectiveMax/temp, AC, level, шесть score/modifier, три ресурса с labels; class summary при необходимости как bounded text по публичным Items. Version fixtures/диагностика. Доказать6.0.6 отдельно; до runtime не включать её в verified support. Conditions/NPC — будущее расширение.

**Риски:** temp HP против tempmax, multiclass derived level, AC после effects, устаревшие ресурсы. **Приёмка:** HP совпадает со знаменателем системного листа5.3.3; temp HP отдельно; level меняется от class Item; ресурсы не названы маной; unsupported типы дают generic/unavailable. CAIN tests проходят.

**Тесты:** tempmax положительный/отрицательный, max0, отсутствующий effectiveMax, AC prepared, multiclass, embedded class/effect updates, dynamic resources, permissions, общий widget/preset; отдельная6.0.6 acceptance перед заявлением совместимости.

### Phase 6.5 — Testing and Documentation

**Цель:** закрыть матрицу совместимости и runtime regressions. **Зависимость:** предыдущие milestones, доступный Foundry/OBS viewer. CAIN/regression проверки выполнять после каждого функционального milestone, не откладывать до конца.

**Ожидаемые файлы:** `tests/*` по пробелам, при необходимости узкие read-only `tools/*`, `README.md`, `docs/EXTENDING.md`, `docs/CAIN.md`, `docs/DND5E.md`, `docs/CAROUSEL.md`, новый `docs/PHASE6_ACCEPTANCE_RU.md`. Production animation/render files — только при воспроизводимом дефекте и отдельном объяснении необходимости.

**Шаги:** canonical check/test; old-schema fixtures; GM preview и отдельный Player `/stream`; реальный OBS Browser Source; запись final states и промежуточных кадров; save/reload/reconnect. Документировать версии, пропуски, reduced-motion/limitations. Измерить normalizations/subscriptions после циклов прежде, чем вводить cache.

**Риски:** unit tests не доказывают CEF animation; GM/viewer permissions; запрет изменения Actors. **Приёмка:** матрица ниже закрыта либо непроверенные версии исключены из support; нет functional diff без проверки или утраты preset/user data.

**Тесты:** раздел 8; реальные Actor read-only. Dynamic scenarios — синтетические fixtures/in-memory stubs; создание/изменение игровых документов требует отдельного разрешения. Недоступный runtime фиксируется как непроверенный, не pass.

## 8. Подробная матрица проверки

| Сценарий | Метод | Ожидаемый результат |
| --- | --- | --- |
| World Actor UUID, invalid/compendium/synthetic | Unit + read-only Foundry lookup | Только допустимый world Actor; invalid не раскрывает данные. |
| Имя/portrait/token portrait | Unit URL cases + доступный Character | Выбранный artwork корректен; небезопасные URL отклонены. |
| CAIN scalars/десять skills | Version fixtures + read-only сверка листа | Типы/значения по схеме; legacy IDs не меняются. |
| Нулевой/отсутствующий/некорректный max | Unit + renderer | Нет NaN, выдуманного0 и ложной полной полосы; current сохраняет исходное число. |
| Stress/Injuries/Overflow растут, Bursts/KP расходуются | Synthetic update hooks | Настроенные правила нужного направления, без предположения «все ресурсы HP». |
| CAT/Psyche и XP/advancement последовательность | Prepared fixtures + серия invalidations | Derived актуальны; итог сходится после отдельных событий. |
| Actor/Item/Effect update/delete | In-memory hooks; реальная запись только с разрешением | Relevant refresh, отсутствие polling; недоступное очищается. |
| Permission loss/смена viewer во время async | Deferred reads + viewer session | Поздний результат не возвращает старые данные; GM fallback отсутствует. |
| Два Actors/несколько widgets/две страницы | Combined tests + Foundry | Независимые UUID/histories; repeated traversal без stale callbacks/timers. |
| Unknown binding/unsupported type/version | Fixtures + editor save/load | Binding сохранён; статус понятен; eligibility использует null. |
| Initial/reload/reconnect/Actor switch | Trigger tests + runtime | Baseline не создаёт false damage/heal; continuous правила восстановлены. |
| Numeric transition/field change/threshold | Synthetic changes + browser frames | Правила по значениям; final DOM корректен; интерполяция не создаёт data events. |
| Fade In/Fade Out/Pulse | Browser + Foundry ApplicationV2 + OBS отдельно | Видимое воспроизведение/final visibility; Exit завершён до disposal. |
| Combined page/Actor transitions | Полные циклы, reset/destroy | Нет skipped cleanup/timers после destroy/неверного Actor data. Покадровая синхронизация клиентов не обещается. |
| Старые presets/overlays schema | import→validate→save→reload fixtures | Дизайн, IDs, animations, assignments/custom assets сохранены. |
| Advanced mappings | Valid/invalid/scoped/legacy fixtures | Нет JS/prototype/HTML execution; приоритет и permissions сохранены. |
| D&D5e HP/AC/classes/resources | Fixtures5.3.3/6.0.6; runtime отдельно | effectiveMax учтён; temp HP отдельно; class/effect invalidation. |
| OBS safety/reconnect | Два клиента + transport tests | Viewer values в renderer; module socket без raw Actors/data payloads. |
| Запросы/cleanup | Счётчики после repeated cycles/teardown | Нет роста subscribers/DOM/timers; оптимизация только по измерениям. |

Настоящий stream клиент штатно получает Documents согласно правилам Foundry/системы. Санитизация адаптера ограничивает данные, используемые модулем, но не превращает весь authenticated клиент в клиент, которому сервер передаёт только scalars. Полные Actor payloads через **модульный** socket по-прежнему запрещены контрактом.

## 9. Анимации, OBS и фактически выполненные проверки

Чувствительны: пересоздание DOM на data update; поздние reads после смены Actor; повторный baseline при восстановлении прав; смена владельца carousel timers; disposal до Exit; повторные subscriptions. План меняет extraction/metadata и использует существующие render/motion/carousel lifecycles. Для renderer исправления сначала нужен воспроизводимый regression case.

Reduced-motion настройка остаётся пользовательской. Ранее исследованный suppress-before-animate описан в [ANIMATION_FORENSIC_REPORT_RU.md](ANIMATION_FORENSIC_REPORT_RU.md); не обходить механизм и не менять системные настройки. Final state элемента не доказывает воспроизведение промежуточных кадров OBS/CEF.

В этой подготовке из canonical module root выполнены:

- **`npm run check`: успешно, 77 JavaScript файлов.**
- **`npm test`: 371 тест; 370 passed, 0 failed, 1 skipped.** Пропуск связан с недоступным созданием symlink/junction в окружении.
- Проверены config/manifest, состав Git baseline/ignore, статический код/локальные схемы; целевая сверка официальных источников.

После baseline изменяются только planning docs; повторные функциональные тесты из-за Markdown не нужны. **Новых runtime-проверок CAIN/D&D5e интеграции, live update сценариев и OBS в Phase6 подготовке не было.** Прежние анимационные наблюдения не считаются будущей Phase6 acceptance. Базы миров не читались, реальные Actors не менялись, системные обработчики/миграции не запускались.

## 10. Первичные источники и решение на утверждение

- [Официальный пакет CAIN](https://foundryvtt.com/packages/cain), [основной репозиторий](https://github.com/diabeatz96/cain), [v1.3.26](https://github.com/diabeatz96/cain/releases/tag/v1.3.26).
- [CAIN Character](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/actor-character.mjs), [base Actor](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/base-actor.mjs), [регистрация моделей](https://github.com/diabeatz96/cain/blob/v1.3.26/module/cain.mjs), [sheet и отношения Items](https://github.com/diabeatz96/cain/blob/v1.3.26/module/sheets/actor-sheet.mjs).
- [D&D5e 5.3.3](https://github.com/foundryvtt/dnd5e/releases/tag/release-5.3.3), [D&D5e 6.0.6](https://github.com/foundryvtt/dnd5e/releases/tag/release-6.0.6), [NPC5.3.3](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/npc.mjs).
- [Foundry v14 Actor public API](https://foundryvtt.com/api/v14/classes/foundry.documents.Actor.html), [Document/permissions API](https://foundryvtt.com/api/v14/classes/foundry.abstract.Document.html).
- [Extension API модуля](../EXTENDING.md), [канонический workflow](../DEVELOPMENT.md).

**Предлагается утвердить:** последовательность 6.1→6.2→6.3→6.4→6.5; CAIN Character scalar-first границы раздела 3; additive v1 контракт и совместимость legacy IDs/mappings; независимый D&D5e PC адаптер после CAIN; обязательную regression/runtime матрицу. Реализация и публикация GitHub — разные разрешения: одобрение Phase6 не означает публикацию кода.

**До явного одобрения функциональные изменения остановлены**, как требует Strict Approval Gate пользовательского запроса. Этот комплект документов — результат подготовки и основание для следующего решения.
