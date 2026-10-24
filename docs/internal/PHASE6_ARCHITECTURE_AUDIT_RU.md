# Phase 6 — аудит архитектуры адаптеров и данных

Дата: 21 октября 2026 года. Статус: подготовка, без реализации.

Проверены исходники установленного модуля в `C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay`. Этот документ описывает фактическую цепочку данных и предлагает совместимое направление развития. Он не подтверждает работу новых возможностей, не объявляет поддержку новых систем и не заменяет проверку конкретной версии CAIN. В рамках отдельной подзадачи статического аудита изменён только данный документ; функциональный код, настройки, миры, пользовательские изображения и `storage/` не изменялись. Инициализация локального Git и результаты общих проверок описаны в основном PHASE6_PLAN_RU.md.

## 1. Фактическая архитектура

| Участок | Текущее поведение | Проверенные исходники |
| --- | --- | --- |
| Регистрация | При загрузке модуля регистрируются generic и CAIN; в `init` создаётся service, расширения получают `api.registerAdapter()` | `scripts/main.js:29`, `scripts/main.js:133`, `scripts/main.js:207` |
| Контракт адаптера | `{id,label,systemId?,fields?,normalize(actor,options)}`; обязательна функция `normalize`; реестр запрещает дубликаты ID | `scripts/core/registry.js:58` |
| Выбор адаптера | Generic плюс **первый** зарегистрированный адаптер, чей `systemId` совпал с `game.system.id` | `scripts/data/character-data.js:54` |
| Каталог полей | Объединение generic, системных descriptors и глобальных mappings; последние значения одного ID заменяют предыдущие | `scripts/data/character-data.js:63` |
| Чтение | `resolve()` выбирает запрошенные поддержанные поля, проверяет Actor и права, вызывает адаптеры, применяет mappings, возвращает `{values,warning}` | `scripts/data/character-data.js:95` |
| Binding | Сохранённые `binding`, `maxBinding` и `{character.*}` содержат нормализованные идентификаторы, не пути к Actor | `scripts/core/schema.js:133`, `scripts/core/schema.js:237`, `scripts/data/bindings.js:12` |
| Представление | Компоненты получают `context.characterData`, читают только свои fields и рисуют DOM; системные пути им неизвестны | `scripts/render/character-components.js:9`, `scripts/render/character-components.js:161` |
| Триггеры | `LayerMotion` отдельно подписывается на fields событий/условий; `TriggerRuntime` сравнивает нормализованные scalar snapshots | `scripts/render/motion.js:63`, `scripts/animation/triggers.js:11`, `scripts/animation/triggers.js:143` |
| Карусель | Доступность Actor и страниц определяется снимками полей; DOM привязывается к выбранному `actorUuid` | `scripts/render/actor-carousel.js:29`, `scripts/render/actor-carousel.js:42`, `scripts/render/carousel.js:23` |
| OBS | Настоящий Foundry `/stream?mso=1`, выбранный Player и тот же renderer/data service | `scripts/integration/obs.js:2`, `scripts/integration/obs.js:14`, `scripts/main.js:258` |

### Полный путь значения CAIN

1. В preset компонент хранит, например, `binding: character.hp.current`; `resource-bar` дополнительно хранит `maxBinding: character.hp.max`. Preset не содержит назначенного Actor (`scripts/core/schema.js:302`).
2. Instance хранит `presetId`, `dataSource`, `actorUuids` и старое совместимое поле `actorUuid`, производное от первого элемента списка (`scripts/core/schema.js:278`).
3. `OverlayRenderer.renderCharacterWidget()` получает preset, применяет допустимые presentation overrides и передаёт назначение Actor вложенному renderer либо `ActorCarousel` (`scripts/render/renderer.js:207`).
4. `requestedFields()` собирает binding и template fields (`scripts/data/bindings.js:12`). `mountCharacterComponent.refresh()` вызывает `service.resolve(actorUuid, fields, {portraitSource})` (`scripts/render/character-components.js:161`).
5. `CharacterDataService.resolveActor()` разрешает только world Actor и проверяет Observer для пользователя представления (`scripts/data/character-data.js:86`).
6. `_adapters()` выбирает generic и CAIN; `cainAdapter.normalize()` читает разрешённые поля из `actor.system` и возвращает плоскую карту (`scripts/data/character-data.js:54`, `scripts/data/character-data.js:115`, `scripts/adapters/cain.js:28`).
7. Service повторно проверяет пользователя и права после асинхронного чтения, фильтрует поля и типы, затем возвращает значения (`scripts/data/character-data.js:120`, `scripts/data/character-data.js:128`).
8. Компонент присваивает текст через `textContent` либо рассчитывает заполнение полосы; исходный Actor не изменяется (`scripts/render/character-components.js:25`, `scripts/render/character-components.js:112`).
9. Foundry lifecycle hooks инвалидируют подписчиков конкретного Actor. Service объединяет события в интервал debounce; компоненты и правила повторно читают актуальные данные (`scripts/data/character-data.js:163`, `scripts/data/character-data.js:181`).

### Каналы данных: важное разграничение

В нынешнем модуле **нет отдельной трансляции нормализованных статистик GM → OBS через module socket**. В каждом авторизованном клиенте `CharacterDataService` читает локально доступные Foundry Documents и нормализует их. GM preview выполняет проверку с правами настроенного Player: `getPresentationUser()` возвращает viewer, а не GM (`scripts/main.js:57`, `scripts/main.js:133`). На `/stream` тот же service работает у вошедшего Player.

Foundry синхронизирует свои Documents и world settings штатным механизмом; обработчик `settingsChanged()` вызывает обновление output (`scripts/main.js:93`). Module socket `module.modular-stream-overlay` используется отдельно для ручных команд анимаций, карусели и подтверждений. Его whitelist содержит IDs, семантическое действие, timestamps и ограниченную конфигурацию эффекта; raw Actor, `system` и `values` в нём отсутствуют (`scripts/animation/transport.js:6`, `scripts/animation/transport.js:21`, `scripts/animation/commands.js:8`).

Следствие: расширение адаптеров само по себе не требует сервера нормализованных snapshots, нового сетевого протокола или доверенного GM proxy. Предлагать такие компоненты как исправление существующего data flow оснований нет. Отдельно потребуется проверять, какие Documents новая игровая система делает доступными Player в `/stream`.

## 2. Что уже обеспечивает совместимость

- Нормализованные `character.*` IDs отделены от `system.*`; один существующий widget может использовать другого Actor без изменения дизайна (`scripts/data/bindings.js:12`, `scripts/core/schema.js:280`).
- Сохранённый старый `actorUuid` преобразуется в `actorUuids`; актуальные schema versions — overlay 6 и widget preset 4 (`scripts/core/schema.js:6`, `scripts/core/schema.js:281`).
- Generic возвращает только имя, портреты, UUID и Actor type. Неизвестная система не получает выдуманные HP/level (`scripts/adapters/generic.js:3`, `scripts/data/character-data.js:54`).
- Неизвестный binding не переписывается в ближайший известный. UI сохраняет его в списке с отметкой недоступности (`scripts/ui/editor.js:718`).
- Missing numeric values не подменяются нулём: service возвращает `null`; для полосы требуются конечные current/max и `max > 0` (`scripts/data/character-data.js:23`, `scripts/render/character-components.js:112`).
- Текстовые шаблоны обрабатывают только декларативные field tokens; результат становится `textContent`, без вычисления выражений и HTML (`scripts/data/bindings.js:25`, `scripts/render/character-components.js:29`).
- Initial snapshots подавляют исторические one-shot события, но восстанавливают допустимые continuous rules (`scripts/animation/triggers.js:143`).

Эти свойства следует сохранить как обязательные контракты Phase 6.

## 3. Текущие ограничения

### 3.1 Реестр и выбор поставщика

Реестр проверяет `id`, `label`, один `systemId`, callback и descriptors. Отсутствуют contract version, диапазон версий системы, применимость к Actor type, capability metadata и политика конфликтов (`scripts/core/registry.js:59`). Несколько разных adapters могут иметь одинаковый `systemId`, но runtime использует только первый (`scripts/data/character-data.js:57`). Это зависимость от порядка регистрации, а не явная композиция providers.

`overlay.adapter.id/config` валидируется и сохраняется (`scripts/core/schema.js:333`), однако в проверенной production цепочке не участвует в выборе CharacterDataService adapter. Service выбирает по текущей системе. Нельзя строить UI выбора адаптера, предполагая, что это сохранённое поле уже переключает нормализацию.

Системный adapter может заменить descriptor generic-поля с тем же ID; mapping не может заменить пять стандартных Actor IDs. Политику защиты базовых semantics пока обеспечивают conventions trusted adapter code, а не единый resolver conflict check (`scripts/data/character-data.js:66`, `scripts/data/mappings.js:16`).

### 3.2 Типы и каталог

Descriptors допускают `string`, `number`, `image`, необязательные `maxField` и `format`; максимум 128 fields у адаптера (`scripts/core/registry.js:67`). Проверяется синтаксис `maxField`, но не существование соответствующего descriptor и не его числовой тип. Runtime не содержит общего каталога ресурсов, групп статистик, enum, units, limits или статусов недоступности.

`format: integer|decimal|percent` хранится в metadata, но текущие text components не используют его как универсальный formatter. Они показывают `String(value)` либо округляют промежуточные значения интерполяции (`scripts/render/character-components.js:5`, `scripts/render/character-components.js:25`). `maxField` используется генератором demo для подбора пар, а редактор полосы предлагает отдельный список maximum fields (`scripts/demo/install.js:64`, `scripts/ui/editor.js:722`).

Trigger runtime допускает boolean scalars (`scripts/animation/triggers.js:8`), но AdapterRegistry и `safeScalar()` не предоставляют boolean end-to-end (`scripts/core/registry.js:75`, `scripts/data/character-data.js:23`). Поддержку условий, флагов состояний и typed boolean controls нельзя объявлять готовой только по возможностям TriggerRuntime.

### 3.3 Нормализация и отсутствие данных

Результат service — `{values, warning}`. Общая строка warning не различает неподдержанную версию системы, неприменимый Actor type, отсутствующий field, неверный тип, отсутствие прав и отсутствие документа (`scripts/data/character-data.js:100`, `scripts/data/character-data.js:134`). Unknown requested IDs отсутствуют в `values`; поддержанные, но недоступные имеют `null`. Это полезное различие сейчас не оформлено machine-readable status contract.

Один resolve ограничен 128 requested fields (`scripts/data/character-data.js:96`). ActorCarousel уже разбивает свои union-запросы на chunks по 127 полей плюс `character.name` (`scripts/render/actor-carousel.js:48`). Прочие потребители не имеют общей batch API. У service нет кэша нормализованных результатов, объединения одновременных read requests или зависимостей полей, кроме специально реализованного HP percent (`scripts/data/character-data.js:111`). Каждый компонент, rules runtime и availability reader может повторять нормализацию одного Actor после одного события.

Debounce уменьшает количество callback rounds, но не превращает их в один общий snapshot. Generation guards у потребителей защищают от устаревшего завершения, не гарантируя единый revision для нескольких одновременно читающих компонентов (`scripts/data/character-data.js:163`, `scripts/render/character-components.js:161`, `scripts/render/motion.js:67`). Новый кэш без учёта viewer identity, permissions и mappings revision создаст риск устаревших или недопустимых значений.

### 3.4 CAIN

Текущий `cainAdapter` экспортирует девять numeric descriptors: current/max/percent здоровья, level, current/max power, current/max stress и psyche (`scripts/adapters/cain.js:17`). Восемь прямых значений берутся из `health`, `attributes.level.value`, `power`, `stress`, `psyche`; процент derived (`scripts/adapters/cain.js:5`). Generic добавляет Actor basics.

В исходнике указан ориентир CAIN 1.3.26, но эта запись не является автоматической проверкой совместимости установленной или будущей версии. Нет проверки Actor type или версии схемы, отдельного каталога поддерживаемых возможностей, коллекций Items/conditions и универсального role mapping для ресурсов. Отсутствие значения честно даёт `null`; нельзя автоматически угадывать альтернативный путь или считать stress/psyche эквивалентом HP.

Health percentage вычисляется и внутри CAIN, и в CharacterDataService, где учитываются overrides mappings (`scripts/adapters/cain.js:33`, `scripts/data/character-data.js:110`). При будущем обобщении derived fields нужно сохранить текущий приоритет mappings и формулы, затем назначить одного владельца вычисления; без отдельной проверки удалять одно из вычислений нельзя, поскольку прямые внешние вызовы `cainAdapter.normalize()` также возможны.

### 3.5 Mappings и UI

Mappings — один world setting, максимум 64 записи, `{id,label,type,path}`, только number/string и ограниченный `system.*` путь. Нет scoping по system/version/Actor type; metadata `maxField`, `format` и resource semantics не сохраняется (`scripts/main.js:127`, `scripts/data/mappings.js:7`). При смене системы mapping продолжает существовать, даже если соответствующий путь уже означает другое.

Путь проходит syntactic denylist и own-property traversal (`scripts/data/mappings.js:4`, `scripts/data/mappings.js:26`). Это ограничение доступа к пути, а не доказательство публичности любого не запрещённого имени поля. Нельзя выводить каталог автоматически из полного `actor.system` или разрешать сырые expressions ради «универсальности». Системные данные и их семантическая допустимость остаются ответственностью проверенного adapter и явно настроенного mapping.

Редактор уже использует `fieldDefinitions()` для selectors и фильтрует numeric fields для числа/полосы (`scripts/ui/editor.js:81`, `scripts/ui/editor.js:716`). Trigger UI также опирается на descriptor type (`scripts/ui/animation-controls.js:132`). Advanced mappings редактируются целиком в JSON textarea, без preview результата, группировки и отдельного статуса каждой записи (`scripts/ui/widget-editor.js:377`).

### 3.6 Документы, события и OBS

Принимаются только persistent world Actor UUID. Synthetic/unlinked Tokens, compendiums, произвольные URLs и вложенные document paths запрещены (`scripts/data/character-data.js:10`, `scripts/core/schema.js:140`). Linked Token hooks могут инвалидировать world Actor, но не добавляют новый binding type (`scripts/data/character-data.js:192`).

Инвалидация покрывает Actor, вложенные Item/ActiveEffect, linked Token и viewer User (`scripts/data/character-data.js:181`). Нет adapter-specific списка зависимостей и hooks для систем, вычисляющих значения из иных коллекций, settings, combat или асинхронных сервисов. Такие зависимости потребуют явного безопасного контракта; один `updateActor` не универсален для всех систем.

ActorCarousel считает Actor доступным по непустому `character.name`; page eligibility затем проверяет реальные bound scalars (`scripts/render/actor-carousel.js:51`, `scripts/render/carousel.js:23`). Rich collections без scalar projection не будут работать в текущих widgets, page skipping и triggers. Карусели в разных клиентах используют собственные timers: этот аудит не утверждает синхронизацию по кадрам между preview и OBS.

## 4. Границы безопасности

1. OBS output разрешён только выбранному lowest-role Player (`scripts/integration/obs.js:14`). GM preview также должен сохранять viewer permission semantics (`scripts/main.js:57`).
2. Observer проверяется перед чтением и после async normalization; смена пользователя либо отзыв прав очищает selected values (`scripts/data/character-data.js:86`, `scripts/data/character-data.js:128`).
3. Renderer не должен получать raw Actor Documents, system paths, приватные заметки или HTML из data service. Это граница данного модуля; она не означает, что штатный authenticated Foundry client в целом никогда не получает Actor Documents.
4. Адаптер — доверенный JavaScript extension. Реестр не является sandbox и не может удержать злонамеренный код адаптера от чтения globals. Permission guards и ограниченный результат обязательны и для trusted extension authors (`scripts/core/registry.js:57`, `scripts/data/character-data.js:118`).
5. Artwork допускает managed paths и credential-free HTTP(S), но не script/data/file URL. Использовать существующий валидатор и renderer; не переносить и не перекодировать пользовательские изображения (`scripts/adapters/generic.js:15`, `scripts/render/character-components.js:206`).
6. Ручные команды требуют authenticated sender identity, GM authority, configured viewer, активный overlay и valid timestamps; payload identity не заменяет транспортную аутентификацию (`scripts/animation/transport.js:136`, `scripts/animation/transport.js:156`, `scripts/animation/commands.js:122`). Расширение данных не должно ослаблять этот whitelist.

## 5. Предлагаемый интерфейс: сохранить scalar bindings, расширять metadata

Рекомендация для Phase 6: развивать существующие AdapterRegistry и CharacterDataService. Сохранить `normalize(actor,{user,fields,portraitSource}) → flat values`, `fieldDefinitions()` и `resolve() → {values,warning}` как совместимый v1. Уже сохранённые IDs не переименовывать и не менять значения единиц. Объекты resources/statistics не вводить вместо текущего `values`: они немедленно нарушат widgets, templates, triggers и page eligibility.

| Расширение | Предлагаемый смысл | Совместимость |
| --- | --- | --- |
| Версия контракта | Необязательная версия adapter interface и явная декларация проверенного system-version range | Отсутствие означает старый v1; существующие регистрации работают |
| Применимость | Необязательный trusted predicate или declaration для system version и Actor types | Существующие `systemId` и `fields` остаются достаточными для старого adapter |
| Capabilities | Ресурсы, статистики, artwork, scalar conditions; без догадок по названию поля | Отсутствие capability не скрывает существующий binding, а помечает его доступность |
| Descriptor metadata | Group, semantic role, units, supported operators; resource descriptor связывает current/max/percent IDs | Нынешние IDs и scalar values сохраняются; новые свойства проходят явную whitelist-валидацию |
| Availability | Необязательный sidecar `fieldStatus` и общий status, без raw document/error dump | Старые callers продолжают читать `values` и `warning`; unavailable scalar остаётся `null` |
| Derived fields | Явные bounded dependencies и единственное место вычисления после mappings | Первая задача — сохранить точно нынешнюю формулу/приоритет HP percent |
| Invalidation | Необязательные adapter dependencies/инвалидация через общий service | Не создавать собственные бесконтрольные watchers на каждый widget |
| Выбор provider | Детерминированная политика и диагностика конфликта для одного systemId | Не включать все providers одновременно и не менять текущий выбор без миграционного решения |

Это проектные предложения, а не существующий API. Конкретные имена новых свойств и signatures должны быть утверждены до реализации. Сейчас AdapterRegistry отбрасывает незнакомые descriptor свойства, а schema validators отбрасывают неизвестные структурные saved fields (`scripts/core/registry.js:76`, `scripts/core/schema.js:327`). Одного добавления metadata в объект адаптера недостаточно.

Для ресурсов использовать descriptor-связь поверх scalar IDs: например, «health» с current=`character.hp.current`, max=`character.hp.max`, percent=`character.hp.percent`. Для CAIN оставить power, stress и psyche собственными semantics; UI получает локализованную подпись из descriptor и не называет каждый числовой ресурс здоровьем. Для других систем добавлять подтверждённые adapter mappings после исследования их публичных моделей, а не обходить весь Actor.

Boolean/enum/collections лучше выделить в последующие независимые решения. Для boolean нужны registry type, service sanitizer, template policy, trigger editor controls и тесты. Для коллекций нужен отдельный bounded catalog/projection contract и новые presentation components; существующий scalar renderer не считать их поддерживающим. Все эти расширения можно отложить, не мешая CAIN-first scalar Phase 6.

## 6. Порядок будущей реализации и критерии допуска

1. Зафиксировать v1 contract и fixtures текущего CAIN: ID, Actor type, system version, прямые/derived поля, `null`, viewer permissions. Сверить фактическую установленную CAIN модель, а не только комментарий в адаптере.
2. Добавить необязательную применимость/metadata и resolver diagnostics. Прежние adapters, saved overlays/presets и advanced mappings должны дать идентичные values и bindings.
3. Описать CAIN resources через metadata, подключить UI labels/grouping и безопасный preview доступности. Не менять дизайн, Actor assignment или карусель при обновлении каталога.
4. Определить scoping mappings и precedence: generic → подтверждённый system adapter → явный mapping → derived fields. Для старых global mappings нужен явно описанный compatible режим; автоматическая перепривязка без проверки запрещена.
5. Только после измерений решать вопрос объединения read requests. Кэш должен учитывать Actor, viewer, permissions, system adapter и mappings revision; отзыв прав и смена viewer обязаны немедленно инвалидировать результат.
6. Проверить настоящий Foundry `/stream` с отдельным Player: generic basics, CAIN resources, изменение Items/effects, удаление/отзыв прав, reload/reconnect, несколько widgets одного/разных Actors. Проверить OBS отдельно; native browser test не считать OBS/CEF test.

Обязательные regressions: старый adapter без новых metadata; unknown system; два adapter с одинаковым systemId; version/type mismatch; maxField с неверным типом; missing/NaN/zero maximum; mapping override и HP percent; permission change во время async read; unknown saved field; literal template HTML; отсутствие raw Actor/values в module socket; baseline/restoration без ложного damage event; repeat carousel traversal и очистка subscriptions.

## 7. Проверенные существующие тесты и границы этого аудита

Следующие тесты прочитаны в статической подзадаче. Общий запуск check/test в подготовке выполнен отдельно; результаты приведены в PHASE6_PLAN_RU.md:

- `tests/data.test.js:27` — metadata validation и выбор системы; `:41` — selected fields; `:57` — CAIN percentages; `:71` — world Actor references; `:82` — viewer permissions; `:95` — отзыв прав во время async read; `:112` — mappings; `:143` — templates; `:175` — инвалидация событий.
- `tests/core.test.js:412` — базовый AdapterRegistry; `tests/core.test.js:354` — совместимая миграция saved state.
- `tests/character-renderer.test.js:62` — независимые Actor bindings; `:77` — patch вместо пересоздания; `:106` — очистка при отзыве прав; `:127` — поздние reads; `:139` — artwork safety.
- `tests/triggers.test.js:15` — начальный baseline; `:61` — continuous reconstruction; `:80` — восстановление доступа без false damage; `:89` — независимые histories.
- `tests/animation-commands.test.js:24` и `:122` — metadata-only commands и schema rejection Actor payload; `tests/animation-transport.test.js:72` — sender authentication; `:148` — cleanup.

Это статический аудит исходников и наличия сценариев. Он не устанавливает результат текущего `npm test`, не подтверждает нового adapter API и не заявляет новую runtime-проверку Foundry/OBS. После будущих функциональных изменений обязательны `npm run check` и `npm test` в canonical module root плюс отдельно зафиксированная runtime acceptance.
