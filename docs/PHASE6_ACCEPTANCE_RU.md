# Phase 6 — реализация 0.6.0 и границы проверки

Дата: 21 октября 2026 года. Реализация выполнена после явного одобрения [подготовленного плана](PHASE6_PLAN_RU.md). Каноническая установка: `C:/Users/Lev/AppData/Local/FoundryVTT/Data/modules/modular-stream-overlay`. Manifest, package и API: **0.6.0**; overlay schema 6 и widget preset schema 4 сохранены.

**Код milestones 6.1–6.4 реализован; автоматизированная часть 6.5 выполнена. Проверка CAIN-полей на реальных Actors и нового интерфейса в авторизованном TEST пройдена. В OBS подтверждён базовый вывод существующего оверлея со сменой страниц и персонажей. Полная приёмка новых CAIN-пресетов и измерение анимаций в OBS/CEF ещё не выполнены.**

## Что реализовано

| Этап | Результат |
| --- | --- |
| 6.1 | Совместимый v1 registry, metadata групп/ролей/единиц, resource pairs, field-level Actor/version guards, статусы, явный выбор provider, scope mappings и preview несохранённых значений. |
| 6.2 | 56 CAIN descriptors: CAT, подготовленная Psyche, Stress, Bursts, Injuries, Divine Agony, Sin Overflow, Kit Points, XP/Advancements, Scrip, десять skills, модификаторы и выбранные короткие строки. Девять старых IDs/путей сохранены. |
| 6.3 | Два opt-in CAIN дизайна, четыре информационные страницы и неактивный пример оверлея. Повторная установка сохраняет edits/Actor assignments/активный эфир, восстанавливая только отсутствующее. |
| 6.4 | Независимый D&D5e PC адаптер: 28 полей HP/effectiveMax/temp/baseMax, AC, prepared level, шесть abilities и три произвольных resource slots. Только schema target 5.3.3; 6.0.6 остаётся исследованной, но недоступной версией. |
| 6.5 | Unit/integration tests, native Chromium UI/renderer acceptance, read-only проверка настоящих CAIN Actors и интерфейса в Foundry, анимации в настоящем ApplicationV2, базовый визуальный вывод OBS, пользовательская и extension документация. Расширенная OBS приёмка остаётся отдельной. |

Инструкции: [CAIN.md](CAIN.md), [DND5E.md](DND5E.md), [EXTENDING.md](EXTENDING.md), [DEMO_GUIDE.md](../DEMO_GUIDE.md).

## Совместимость и права

Существующие saved overlays/presets читаются без автоматической записи или миграции. Нормализованные scalar IDs остаются отделёнными от system paths. Старые `character.hp.*`, `character.power.*`, `character.level`, `character.stress.*`, `character.psyche` не меняют семантику. Новые CAIN поля доступны только Character/1.3.26; D&D5e — Character/5.3.3. Иной Actor/версия дают недоступность, а не предположенный ноль.

Старые mappings без scope остаются global и помечены **all systems**. Optional system/type/version scope добавляется явно. Auto сохраняет первый matching provider; конфликт показан, явный выбор сохраняется отдельно. Не найденный явный provider не заменяется другим молча. `overlay.adapter.id/config` не активирован скрыто.

Service сохраняет `{values,warning}` и добавляет status/fieldStatus. Неизвестный ID отсутствует в values; известный недоступный — null. Numeric maxima проверяются в выбранном каталоге. Некорректная resource pair после смены scope/provider изолирована: она не скрывает имя, портрет и другие поля. Невалидные сохранённые mappings пропускаются с предупреждением, оставляя adapter fields доступными.

Observer проверяется под Player вывода до и после async reads. Потеря права и смена viewer очищают значения; preview mappings не меняет live settings. Полные Actor/Item/Effect, приватные описания, HTML и код не выдаются renderer. Module socket остаётся каналом команд, не Actor values. Сам штатный авторизованный Foundry client получает Documents по правилам Foundry — модуль не заменяет серверный ACL.

## Автоматические и браузерные результаты

Финальные результаты команд должны соответствовать последнему прогону из canonical root; подробный локальный лог: `work/phase6-tests.log`.

- `npm run check`: manifest, импорты, assets и синтаксис; **89 JS файлов**, успешно.
- `npm test -- --test-timeout=20000`: **409 tests, 408 passed, 0 failed, 1 skipped**. Единственный skip — запрет ОС на создание тестового symlink/junction. Дополнительный timeout ограничивает зависшие тесты и не исключает сценарии.
- `tools/phase6-browser-check.mjs`: **8 passed, 0 failed**, native Chromium, настоящие production classes адаптеров/редактора/renderer/carousel; ApplicationV2 shell и game/settings/Actors в этой среде — тестовые, память браузера. Это не настоящий Foundry lifecycle.
- `tools/animation-browser-check.mjs`: **17 passed, 0 failed** после интеграции; native browser Fade/Pulse/Exit/Entrance, preference blockers, DOM и carousel regression cases. Это не OBS/CEF.

Проверены: idempotent opt-in installation; сохранение текущего оверлея; временный preview Actor без UUID в preset; фильтрация numeric полей; explicit maximum pairing и сохранение; scoped mapping preview без записи; неверный JSON; сериализация provider defaults; unverified-version; две оси, 8 пар CAIN; live fixture update, trigger и cleanup; permission loss.

Для Stress 2/6→4/6 измерена native browser полоса: начальная 33.3333%, промежуточная между 33.3333% и 66.6667%, финальная 66.6667%. Элемент DOM тот же; правило `cain-stress-increase` сработало. Все изменения — только синтетические Actors в памяти.

Локальные доказательства (игнорируются Git): `work/phase6-browser/evidence.json`, `work/phase6-browser/cain-card.png`, `work/phase6-browser/designer.png`, `work/animation-forensics/evidence.json`. Скриншоты просмотрены; числовые значения примеров вынесены над полосами для читаемости на светлом фоне.

## Проверка в настоящем Foundry

После ручного открытия TEST и входа GM подтверждены: **Foundry 14.368**, **CAIN 1.3.26**, активный module API **0.6.0**. Проверка через текущую авторизованную сессию: **8 passed, 0 failed**. Обезличенные результаты: `work/phase6-foundry/evidence.json`.

- У каждого из **4 Characters** все **56 CAIN значений** совпали с подготовленными system fields: **224 сравнения, 0 расхождений**. Пустых/недоступных полей у этих Characters не было. Это включает сохранённые legacy пути; тест не переопределяет их семантику.
- Штатный CharacterDataService, использующий настроенного **Player role 1**, вернул все 56 полей для каждого из четырёх разрешённых Characters. Каталог содержит 56 CAIN и 5 generic identity descriptors. Отдельный GM fallback не применялся.
- Через штатный API открылись настоящий OverlayEditor и WidgetPresetManager: ApplicationV2, canvas и три новых действия библиотеки доступны.
- В отдельном экземпляре настоящего WidgetPresetEditor с CAIN дизайном только в памяти и реальным разрешённым preview Character проверены numeric selectors, исключение text fields из resource bar, сохранение старого maximum при смене current и явное применение matching maximum. UUID preview Character отсутствует в дизайне.
- Настоящий DialogV2 проверен для несохранённого scoped mapping: Kit Points совпал с Actor, ошибочный JSON показан в диалоге. Read-only тестовый setter запрещал сохранение; диалог закрыт без submit.
- Native provider dialog сохранил явно выбранный default после HTML serialization; Auto также доступен. Тестовые preferences существовали только в памяти, реальная настройка не менялась.
- До и после совпали `state`, `widgetPresets`, `fieldMappings`, `adapterPreferences`, `viewerUserId`. Все временные окна закрыты; число подписок CharacterDataService вернулось **0 → 0**, preview renderer уничтожен.

Повторный `tools/animation-foundry-check.mjs` после запуска мира: **7 passed, 0 failed**. Это реальный Foundry ApplicationV2 на `/join`, production AnimationController/OverlayRenderer и временные DEMO DATA в памяти. Измерены промежуточные Fade/Pulse/Slide, production Fade In/Fade Out/Pulse и cleanup; DOM оставался тем же без rerender. Результаты: `work/animation-forensics/foundry-evidence.json`, лог `work/phase6-foundry-animation.log`. Этот прогон не использует настоящие Actors, модульный редактор или OBS. Ранний запуск до активации мира завершился environment timeout до первого теста; его не считали успешной проверкой.

### Визуальная проверка OBS

В **OBS 32.2.2** осмотрен существующий Browser Source **Browser 3**, исходный адрес `http://localhost:30000/stream?mso=1`, размер **1920×1080**. Первоначально кадр был чёрным. Пользователь вручную изменял подключение; в это время агент не выполнял ввод в OBS. После ручной настройки источник показал существующий showcase с реальными Characters и числовыми legacy полями. В основном preview и окне Interact наблюдались **два разных Characters**, страницы Additional Information и Visual Showcase и автоматическое переключение между ними. Трансляция и запись оставались выключенными.

Это **визуальная smoke-проверка**, без CEF instrumentation: точный пользователь/API version внутри CEF, промежуточные кадры анимации и её длительность не измерялись. Новые CAIN-пресеты в настоящий мир не устанавливались и в OBS не публиковались. Агент не менял URL, размер или другие настройки Browser Source. Окно Interact закрыто после проверки; наблюдения добавлены в `work/phase6-foundry/evidence.json`.

## Оставшиеся границы проверки

Штатные reads под правами настроенного Player в GM-сессии и видимый OBS вывод не заменяют инструментальную проверку Player `/stream` identity/API и измерения OBS/CEF. Live Actor update сценарии проверены синтетически; реальные Actor/Item документы не изменялись. D&D5e в настоящем мире, версия 6.x и новые CAIN примеры в реальном OBS пока не проверены.

Вход не автоматизировался согласно [computer-use skill](C:/Users/Lev/.codex/plugins/cache/openai-bundled/computer-use/26.1013.40934/skills/computer-use/SKILL.md) и его [guidance](C:/Users/Lev/.codex/plugins/cache/openai-bundled/computer-use/26.1013.40934/docs/guidance.md): “Do not automate user authentication dialogs.” Новую защиту DevTools от вставки снял пользователь вручную; после этого выполнялся только согласованный диагностический код.

## Репозиторий и сохранность

Baseline остаётся **0e32ed6**, тег **pre-phase-6-stable-v0.5.5**; документы плана — **26aa12c**. Функциональные изменения 0.6.0 находятся в working tree canonical installation, без новых Git metadata writes. Remote не создавался; публикации/force-push/reset не было.

Не менялись `storage/`, пользовательские изображения, другие модули, файлы игровых систем, world databases и реальные Actor/Item документы. Установщики примеров в настоящем мире автоматически не запускались. Их создание в тестах использовало только memory stores. Существующий animation/render/carousel engine и transport source не переписывались; изменения данных и controls используют его прежние lifecycle.

## Повторение изолированных браузерных проверок

Используйте уже установленный Playwright runtime и Chromium, без установки зависимостей в модуль:

```powershell
$env:MSO_PLAYWRIGHT_MODULE='C:/Users/Lev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:MSO_CHROMIUM_EXECUTABLE='C:/Users/Lev/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe'
node tools/phase6-browser-check.mjs
node tools/animation-browser-check.mjs
```

В ограниченной среде запуск Chromium потребовал штатного sandbox escalation; автоматический review разрешил запуск. Политики безопасности Windows и браузера не менялись. Предварительные неуспешные UI-прогоны выявили ошибки самого mock shell (binding native structuredClone и порядок окон); после исправления fixture пройдены все 8 проверок. Реализация не использует эти mocks в Foundry.
