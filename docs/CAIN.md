# CAIN 1.3.26 — интеграция персонажей

Модуль 0.6.0 читает подготовленные публичные scalar значения world Actor. Цель схемы — установленная **CAIN 1.3.26**, Foundry v14. Проверенные версии здесь означают изученную схему и синтетические fixtures; результаты настоящего Foundry/OBS прогона отдельно перечислены в [PHASE6_ACCEPTANCE_RU.md](PHASE6_ACCEPTANCE_RU.md).

## Настройка

1. В настройках оверлея выберите отдельную учётную запись для OBS. Подходит любая роль: помощник ведущего уже видит всех персонажей, игроку нужен доступ наблюдателя (Observer) к нужным Characters.
2. Откройте **Widget Preset Manager → Install CAIN examples**. Будут добавлены два редактируемых дизайна и неактивный пример оверлея. Установка не создаёт Actors, не назначает их автоматически и не переключает эфир.
3. Откройте **CAIN — Character Examples**, назначьте world Character экземпляру **CAIN — Exorcist Card**. Для нескольких персонажей добавьте UUID в Carousel Settings и выберите Combined.
4. Основной дизайн содержит четыре страницы: Condition, Resources, Skills, Progression. Портрет, имя, CAT/Psyche и XID остаются общими. **CAIN — Compact Status** показывает короткую карточку со Stress и Psyche Bursts.
5. В дизайнере выберите поле из подписанного каталога. Для resource-bar есть **Use matching maximum**: кнопка явно выбирает объявленный maxField, не изменяя оформление. Сам выбор current не заменяет выбранный вручную максимум.
6. Сохраните дизайн, затем назначение экземпляра. Preview Actor не сохраняется в самом дизайне. Установка примеров повторно сохраняет ваши изменения; восстанавливается только отсутствующий пример.

Можно собрать собственную карточку из обычных text/numeric/portrait/resource-bar компонентов. Специальные CAIN-компоненты и новое приложение редактора не требуются.

## Поддержанные значения

Каждый элемент таблицы — отдельный scalar binding. Запись `.current / .max` сокращает два отдельных ID. Все новые `character.cain.*` поля доступны только для `actor.type === "character"` и system version линии `1.3.x` (патч-релизы проверенной `1.3.26`; суффиксы вроде `-beta` не принимаются). Неподтверждённая версия или иной Actor type не подменяется догадкой.

| Binding | Подготовленный путь в `actor.system` | Семантика |
| --- | --- | --- |
| `character.cain.cat` | `CATLEVEL.value` | CAT; не legacy level. |
| `character.psyche` | `psyche` | Уже вычисленная системой Psyche; адаптер не пересчитывает её. |
| `character.stress.current / .max` | `stress.value / .max` | Накопительный Stress; рост неблагоприятен. |
| `character.cain.psycheBurst.current / .max` | `psycheBurst.value / .max` | Psyche Bursts; не generic Power. |
| `character.cain.injuries.current / .max` | `injuries.value / .max` | Injuries; не производная от HP. |
| `character.cain.divineAgony.current / .max` | `divineAgony.value / .max` | Divine Agony; нейтральная metadata polarity, направление правила выбирает автор. |
| `character.cain.sinOverflow.current / .max / .min` | `sinOverflow.value / .max / .min` | Sin Overflow и границы. |
| `character.cain.kitPoints.current / .max` | `kitPoints.value / .max` | Kit Points. |
| `character.cain.xp.current / .max` | `xp.value / .max` | XP; не CAT. |
| `character.cain.advancements.current / .max` | `advancements.value / .max` | Advancements. |
| `character.cain.scrip` | `scrip` | Scrip. |
| `character.cain.skills.<key>.rating / .max` | `skills.<key>.value / .max` | Рейтинг навыка в dice, не D&D ability score. |
| `character.cain.extraDice` | `extraDice.value` | Дополнительные d6. |
| `character.cain.restDiceModifier` | `restDiceModifier` | Модификатор отдыха. |
| `character.cain.xid` | `XID` | Короткая строка по явному выбору. |
| `character.cain.agenda` | `agenda` | Свободная подпись, не разрешение Item ID. |
| `character.cain.blasphemy` | `blasphemy` | Свободная подпись, не список Powers. |
| `character.cain.appearance.<key>` | `sex`, `height`, `weight`, `hair`, `eyes` | Строки, включая height/weight; только выбранные bindings. |

Ключи навыков: `force`, `conditioning`, `coordination`, `covert`, `interfacing`, `investigation`, `surveillance`, `negotiation`, `authority`, `connection`. Например, `character.cain.skills.force.rating` и `character.cain.skills.force.max`.

Всего CAIN даёт **83 descriptors**, включая девять прежних, семь совместимых текстовых представлений коллекций и 20 отдельных полей для имён/описаний/краткого текста/числа способностей. Generic добавляет имя, profile/token artwork, UUID и тип Actor. Портрет токена означает artwork prototype token, а не произвольного активного токена сцены. Числа принимаются только как finite numbers, прямые строки ограничены 1000 символами и отображаются через plain text. Нули сохраняются; отсутствующие/некорректные значения возвращают null. Полоса требует max>0, её fill ограничен 0–100%, но исходное число current не искажается.

## Выбранные способности, недуги и метки

Эти дополнительные строковые bindings читаются только при явном выборе в компоненте. Версия/тип остаются CAIN 1.3.26 / Character. Прямые `character.cain.agenda` и `.blasphemy` по-прежнему возвращают свободный текст листа; новые `.label` разрешают названия выбранных Items.

| Binding | Источник | Вывод |
| --- | --- | --- |
| `character.cain.afflictions.summary` | `system.afflictions` | Названия актуальных недугов; полные описания не запрашиваются. |
| `character.cain.powers.summary` | `system.currentBlasphemyPowers` | Названия и краткий открытый текст изученных сил. |
| `character.cain.agendaAbilities.summary` | `system.currentAgendaAbilities` | Названия и краткий открытый текст полученных способностей подхода. |
| `character.cain.agendaTasks.summary` | `system.currentUnboldedAgendaTasks`, `system.currentBoldedAgendaTasks` | Тексты задач; `▸` — обычные, `◆` — выделенные. |
| `character.cain.sinMarks.summary` | `system.sinMarks` | Названия текущих меток; не legacy `currentSinMarks`. |
| `character.cain.agenda.label` | `system.currentAgenda` → мировой `Item.name` | Заголовок выбранного подхода, как в листе Character; не устаревшее `system.agendaName`. |
| `character.cain.blasphemy.label` | `system.currentBlasphemies` | Названия выбранных богохульств. |

Для редактируемого оформления отдельных заголовков и описаний доступны `character.cain.powers.entry1.name` / `.description` / `.preview` и `character.cain.agendaAbilities.entry1.name` / `.description` / `.preview`, аналогично `entry2` и `entry3`. Эти строки сохраняют порядок приобретённых способностей и персональные правки embedded Items. Имена сил читают `system.powerName`, имена способностей подхода — `system.abilityName`, как соответствующие строки штатного листа. Отдельное описание допускает до 6000 символов, а `.preview` даёт до 90 символов обычного текста с явным многоточием и сокращением по границе слова для компактного макета. `character.cain.powers.count` и `character.cain.agendaAbilities.count` дают полное число выбранных доступных записей. Неиспользуемые позиции валидного списка возвращают пустую строку, а не выдуманную способность. Недоступная коллекция даёт `null` для имён, описаний и счётчика. Summary bindings сохранены для прежних дизайнов.

CAT-вставки в описаниях (`{<CAT> range}`, `{<CAT/2> people 1}` и HTML-encoded варианты) преобразуются в обычный текст по таблице CAIN 1.3.26 и подготовленному `CATLEVEL.value` до очистки HTML. Разрешена только ограниченная грамматика таблицы и операций `+`, `-`, `*`, `/` с округлением деления вверх и пределом CAT 0–7. Произвольные формулы/rolls/helpers не исполняются. Неизвестные будущие ключи сохраняются как видимая CAT-запись, а не исчезают как HTML-тег. Названия и тексты не переводятся адаптером: словарь CAT соответствует установленной системе.

Порядок ссылок сохраняется, дубликаты исключаются. Как в листе CAIN, сначала проверяется Item с этим ID на самом Actor, затем мировой Item. Личная копия силы сохраняет собственные правки. Embedded Item допускается только при совпадающем родительском Actor и Observer-доступе viewer к этому Actor. Для мирового Item дополнительно нужен Observer-доступ того же viewer; GM preview не подменяет его правами GM. Документы из compendium, неожиданные типы, битые ссылки и недоступные Items дают `null` для соответствующего поля, а не ложное состояние «недугов нет». Валидный пустой список и отсутствующий подход (`INVALID`) дают `—`. Результат не содержит ID ссылок и полных Documents.

Каждая коллекция ограничена 32 ссылками, имя — 160 символами, краткое описание — 800, общий вывод — 6000. Более длинный итог явно заканчивается многоточием. Слишком большой/некорректный вход не читается частично. Rich text разбирается в отдельном инертном HTML template, который не монтируется в документ и не загружает изображения/iframe: secret/hidden, script/style и другие исполняемые/скрытые блоки удаляются до извлечения plain text. Формулы и enrichers не выполняются, UUID-ссылки превращаются в подписи без ID. В Node/CLI без браузерного HTML parser rich input возвращает `null`; настоящие браузерные визуальные проверки нужно выполнять отдельно.

Actor/embedded Item hooks обновляют текущие значения. Для мировых Items `cainAdapter.affectsChange` использует существующие create/update/deleteItem hooks сервиса: изменение текста, прав, удаление и повторное появление Item обновляют подписанные карточки с соответствующей ссылкой. Адаптер не вызывает обработчики листа, миграции, создание embedded Items или запись документов.

## Старые привязки и доступность

`character.hp.current/max/percent` продолжают читать `health`, `character.power.current/max` — `power`, `character.level` — `attributes.level.value`. Они отображаются в группе Legacy и не превращаются в CAT, Bursts или Stress. Существующие `character.stress.*` и `character.psyche` также сохраняют старую применимость: новые строгие version/type guards к ним не применяются автоматически.

Новые поля имеют metadata actorTypes/testedSystemVersions; они не загружают полный Actor в renderer. При отказе прав или смене viewer выбранные значения очищаются, в том числе после async read. Неизвестный ID отсутствует в `values`; известный недоступный ID имеет null. Дополнительный `fieldStatus` объясняет причину без раскрытия чужих документов.

Новый provider setting выбирается через **Data provider** в библиотеке. Auto сохраняет прежний первый matching adapter. При нескольких провайдерах показан конфликт; можно явно выбрать внешний зарегистрированный адаптер. Не найденный явно выбранный provider даёт только generic identity и предупреждение. `overlay.adapter.id/config` не активированы как скрытый переключатель.

## Обновления и анимации

Используются существующие Actor/embedded Item/ActiveEffect/linked Token/User hooks и debounce. Читается `actor.system` после подготовки системой; адаптер не вызывает rolls, sheet/getRollData, handleXP, миграции или update(). Последовательные изменения XP/Advancements могут дать промежуточное состояние; после invalidation считывается текущий результат.

Дизайн примера содержит отдельные increased rules для Stress и Injuries. Для других ресурсов направление правила выбирайте по игровой семантике. Начальный snapshot, смена Actor и восстановление доступа не должны воспроизводить исторические one-shot события. Рабочие Fade In/Out, Pulse, numeric/bar transitions, page/Actor lifecycle используют прежний движок. Reduced-motion настройки сохраняются.

## Границы первого выпуска

Не транслируются raw Items, массивы, ActiveEffect, notes/biography, raw HTML, GM secrets, boolean и исполняемые формулы. Только перечисленные выше коллекции имеют bounded plain-text projection. Полные описания недугов, Bonds, talisman selectors, Sin/Opponent и Hunt/global clocks остаются за пределами провайдера. `hideFromTracker` не является Foundry ACL. Отдельных ФИО и позывного в схеме Character нет: `character.name` читает имя Actor. Трек `injuries` означает раны/травмы экзорциста, а не `traumas` противника Sin.

Мировые настройки CAIN не читаются автоматически. Адаптер не мигрирует world catalog и не создаёт тестовых документов. Дальнейшие коллекции требуют отдельной политики стабильных ссылок, Item permissions, обновления world Items и bounded scalar projection.

Полная исследованная карта, безопасные примеры и точные source references: [PHASE6_CAIN_FIELD_MAP_RU.md](PHASE6_CAIN_FIELD_MAP_RU.md). Реализация: `scripts/adapters/cain.js`, `scripts/adapters/cain-fields.js`; синтетические fixtures: `tests/fixtures/cain-1.3.26.js`. Первичные источники: [официальный пакет](https://foundryvtt.com/packages/cain), [Character v1.3.26](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/actor-character.mjs), [base Actor](https://github.com/diabeatz96/cain/blob/v1.3.26/module/data/base-actor.mjs).
