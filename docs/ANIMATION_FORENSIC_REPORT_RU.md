# Независимое расследование анимаций оверлея

Дата завершения: 21 октября 2026 года. Проверена установленная версия модуля 0.5.5, Foundry **14.368**, OBS **32.2.2**, Windows. Этот отчёт дополняет исторический `ANIMATION_FIX_REPORT.md`: прежние ограничения проверки больше нельзя переносить на результаты этого расследования.

## Результаты исследования

### Проверенная установка и цепочка выполнения

Работа выполнена непосредственно в `C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay`. `Config/options.json` указывает `dataPath: C:/Users/Lev/AppData/Local/FoundryVTT`; `module.json` ограничивает совместимость v14. Контрольные суммы полученных по HTTP `main.js`, `playback.js`, `renderer.js`, `motion.js` и `renderer.css` совпали с установленными файлами. Другая копия модуля или устаревшая gzip-версия сервера не объясняют этот случай.

Конкретный запрос **Play Pulse Animation** проходит следующий путь:

1. `scripts/ui/animation-controls.js`, `renderAnimationTestControls()` / `run()` — кнопка формирует `kind: play`, `type: pulse`, `duration: 1200`, `intensity: 1`.
2. `scripts/ui/editor.js:295`, `_runAnimationTest()` — ожидает обновление preview и обращается к его текущему renderer.
3. `scripts/render/renderer.js:287`, `handleAnimationCommand()` — выбирает внешний `LayerMotion` карточки, а не вложенную масштабированную сцену Actor.
4. `scripts/render/motion.js:191`, `LayerMotion.play()` — передаёт конфигурацию контроллеру.
5. `scripts/animation/playback.js:152`, `AnimationController.play()` — проверяет блокировки **до** `Element.animate()`, валидирует конфигурацию и строит ключевые кадры.
6. Если блокировки нет, WAAPI получает ключевые кадры и действительную длительность; `ready`, `finished`, отмена и cleanup принадлежат этому Animation.

Fade In/Out проходят через тот же dispatcher, `LayerMotion.enter()` / `exit()` и канал `visibility`. Конфигурация наследуется из preset через `effectiveWidgetMotion()`, если instance не включает собственные overrides. Данные проходят валидацию схемы; существующие preset/Actor-ссылки сохраняются.

Для OBS цепочка добавляет `liveControls.testCommand()` → `AnimationCommands.publish()` → `StreamCommandTransport.send()` → модульный socket → `receive()` → тот же `handleAnimationCommand()`. Подтверждение транспорта означает принятие запроса, а не измеренный кадр.

Триггеры используют тот же движок: hooks в `CharacterDataService.start()` → `_schedule()` → подписка `LayerMotion` → `runtime.update()` → `TriggerRuntime._update()` / `evaluateCondition()` → `onAction` → `LayerMotion.action()` → выбранный `target.play()`. Ручное правило проходит `manual()` → `_dispatch()`. Отдельная подписка в `mountCharacterComponent()` вызывает `refresh()` / `paint()` и обновляет данные существующего DOM. Исходные снимки данных не выдаются за исторические события урона.

Инициализация находится в `scripts/main.js`: `init` регистрирует settings, store, data service и публичное API; `streamReady` создаёт production `OverlayRenderer` на `#mso-output`. Настоящая OBS-страница — `/stream?mso=1`, с авторизацией выделенного Player.

### Внешние источники и их применимость

- [Foundry v14 ApplicationV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html): жизненный цикл render, `_replaceHTML()` и `_onRender()` требует учитывать замену дочернего HTML. Это проверено в коде модуля; использование ApplicationV2 само по себе не доказывает дефект анимации.
- [Foundry module manifest](https://foundryvtt.com/article/module-development/#the-module-manifest): файлы `styles` загружаются в игровую сессию. Здесь manifest содержит renderer/editor/layer-canvas CSS, а фактически отданный renderer CSS совпадает с установленным.
- [MDN Element.animate()](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate), [getAnimations()](https://developer.mozilla.org/en-US/docs/Web/API/Element/getAnimations), [playState](https://developer.mozilla.org/en-US/docs/Web/API/Animation/playState): вызов создаёт Animation, но для доказательства нужны его состояние и реальное изображение. В новых браузерных проверках WAAPI не подменяется.
- [MDN Animation.finished](https://developer.mozilla.org/en-US/docs/Web/API/Animation/finished), [cancel()](https://developer.mozilla.org/en-US/docs/Web/API/Animation/cancel): завершение и отмена различаются; cancel отклоняет текущее finished promise. Подавленное исключение поэтому не является доказательством успешного воспроизведения.
- [MDN getComputedStyle()](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle): возвращает текущее вычисленное значение анимируемого свойства. Диагностика сохраняет значения строками в момент замера, а не живой CSSStyleDeclaration.
- [MDN isConnected](https://developer.mozilla.org/en-US/docs/Web/API/Node/isConnected), [innerHTML](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML): проверены подключение и идентичность узла. Отсоединение узла не приравнивается без проверки к явному вызову cancel.
- [MDN cascade](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction#inline_styles), [KeyframeEffect.composite](https://developer.mozilla.org/en-US/docs/Web/API/KeyframeEffect/composite): обычный inline transform не подавляет анимацию автоматически; `!important` и конкурирующие эффекты требуют отдельной проверки. Композиция `replace` может создавать частные конфликты каналов, но общей причиной данного отказа не оказалась.
- [MDN CSS transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Transitions/Using#javascript_examples): вставка узла и конечного CSS-состояния в одном обновлении может не создать transition. Основной движок здесь использует явные WAAPI keyframes, поэтому это не объясняет общий отказ Fade/Pulse.
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion): query отражает предпочтение среды. Сам браузер не обязан запрещать WAAPI; именно код этого модуля использует query как общий запрет.
- [OBS Browser Source](https://obsproject.com/kb/browser-source): источник использует CEF, имеет настройки FPS, выгрузки и refresh при смене сцены. Документированного общего запрета на CSS/WAAPI-анимации не найдено.
- [OBS issue #307](https://github.com/obsproject/obs-browser/issues/307): сообщается о приостановке невидимого источника в OBS 27.0.1. Это проверяемая отдельная гипотеза жизненного цикла, не доказательство причины текущего Windows/OBS 32.2.2 случая.
- [OBS issue #488](https://github.com/obsproject/obs-browser/issues/488): кадровые артефакты под нагрузкой отличаются от наблюдаемого полного пропуска эффектов. [Foundry issue #5441](https://github.com/foundryvtt/foundryvtt/issues/5441) описывает жизненный цикл ApplicationV2, но не устанавливает общего дефекта Fade/Pulse v14. [Sortable discussion #2027](https://github.com/SortableJS/Sortable/discussions/2027) иллюстрирует конкуренцию владельцев transform; чужое решение в модуль не переносилось.

Специального ограничения Foundry v14, запрещающего DOM-анимации модуля, в изученной документации не обнаружено. Обсуждения на GitHub не использовались вместо локального воспроизведения.

## Корневая причина

**В реальном Electron-клиенте Foundry режим reduced motion блокировал весь production animation pipeline.** В настройках мира были включены и **Enable overlay animations**, и **Respect reduced motion**. На настоящей Actor-карточке диагностика показала:

```json
{"type":"fade-in","duration":600,"phase":"skipped","connected":true,"status":"disabled","reason":"reduced-motion"}
```

Это записано в `work/animation-forensics/foundry-live-before.json`. Источник — панель настоящего OverlayEditor в запущенном мире TEST, а не искусственный DOM.

Причинная цепочка:

- `scripts/main.js:41–47`: media query и `respectReducedMotion !== false` дают контексту renderer `reducedMotion: true`.
- `scripts/animation/playback.js:126–133`: `getBlockedReason()` возвращает `reduced-motion`; `canPlay()` становится false.
- `playback.js:158`: `play()` завершается раньше `Element.animate()`. Поэтому новые keyframes, длительность и transform не могут исправить такой пропуск.
- `scripts/render/carousel.js:39` и `scripts/render/actor-carousel.js:21`: `canAnimate()` зависит от того же `canPlay()`. Содержание продолжает меняться, но переход выполняется сразу.

После отключения **только существующей настройки модуля Respect reduced motion** через штатный интерфейс Foundry на тех же реальных карточках появились `started`, промежуточные computed styles и `finished`. Windows, настройки интерфейса Foundry и данные Actor не менялись. Это контролируемое изменение одного условия при неизменном движке.

Отдельный Headless Chromium 156 сообщал reduced motion=false и воспроизводил эффекты ещё **до** исправления настройки мира. Это важное различие сред: состояние независимого браузера нельзя выдавать за состояние Electron или CEF.

### Проверка гипотез

| Гипотеза | Результат |
| --- | --- |
| A. Цель заменяется при каждом эффекте/событии | Не подтверждено для кнопок, Actor updates и обычной карусели. Браузерные тесты проверили identity/isConnected. Явный render конфигурации действительно заменяет сцену и штатно отменяет эффект с `render-interrupted`. |
| B. Layout transform уничтожает все эффекты | Не подтверждено. Текущий код добавляет базовый inline transform к ключевым кадрам; измерены scale/translate и возврат координат. Возможная конкуренция двух эффектов на одном свойстве остаётся частным случаем, не причиной полного отказа. |
| C. Конфигурация теряется | Не подтверждено. В реальном клиенте видны правильные type/duration/target, а после снятия блокировки они воспроизводятся без изменения preset. |
| D. Мгновенная отмена/завершение | Для исходного отказа запрос был **пропущен до создания Animation**, а не отменён. Отдельная проверка rerender доказала корректную диагностируемую отмену. |
| E. CSS переопределяет opacity/transform | Не подтверждено. Существующие стили не содержат общего запрета этих свойств; реальные промежуточные значения и пиксели меняются. |
| F. Среда браузера | Подтверждено: preference gate в реальном Foundry. OBS отдельно проверен на production URL; общего дефекта CEF не установлено. |

Код карусели сохраняет уходящий DOM до окончания выхода: `WidgetCarousel.changePage()` ожидает gate-операции; `ActorCarousel.present()` ожидает выход старой карточки, затем вход новой. Динамические Actor-компоненты обновляют существующие узлы. Архитектурной переделки для этого отказа не требуется.

## Почему прежние исправления не устранили проблему

В текущей версии уже присутствовали корректные keyframes Pulse, выбор внешней поверхности карточки, удержание выхода и диагностические события. Независимый прогон подтвердил их работоспособность. Менять их повторно было бы неподтверждённой правкой.

Исторический отчёт прямо признавал отсутствие измерений production DOM и недоступность действующего мира. Его unit-тесты в основном подменяли Animation и вручную завершали promises. Поэтому они не доказывали изменение изображения в конкретном Foundry-клиенте. Главное оставшееся условие — **Respect reduced motion** — продолжало блокировать исправленный код. Предупреждение было недостаточно заметно: до нажатия кнопки причина отсутствия эффектов не показывалась постоянно.

Полной истории правок/Git-истории у исследованной установки нет; утверждать намерения прежних разработчиков или приписывать им иные причины оснований нет.

## Внесённое исправление

1. В активном мире TEST через публичный UI изменено **Respect reduced motion: true → false**. **Enable overlay animations** оставлено включённым. Это осознанное разрешение запрошенных пользователем анимаций оверлея; системное предпочтение не выключалось. Новые миры и существующие явные настройки не мигрируются и не сбрасываются.
2. `scripts/ui/animation-controls.js`: причина блокировки видна сразу для выбранного preview-виджета, независимо от debug. Текст объясняет, что подавляются Fade/Pulse и переходы карусели, и указывает точный путь к настройке. Сообщение отделено от результата команды и обновляется при выборе виджета/выхода и Refresh diagnostics. Локальное состояние не выдаётся за состояние OBS.
3. `scripts/main.js:116`: описание существующей настройки прямо объясняет её влияние на анимации всего оверлея. Новых настроек не добавлено.
4. `tests/animation-ui.test.js`: регрессии для немедленной видимости блокировки, перехода blocked → unblocked без debug и независимого состояния OBS.
5. Добавлены отдельные воспроизводимые браузерные диагностики `tools/animation-browser-check.mjs` и `tools/animation-foundry-check.mjs`. Они используют тот же production AnimationController/renderer, нативный WAAPI и временные данные в памяти; альтернативного движка нет.

Renderer, carousel sequencing, bindings, schemas, manifest и версия пакета не переписывались. Сохранённые overlay/preset, пользовательские изображения и `storage/` не менялись. Файлы баз миров напрямую не редактировались; единственная намеренная сохраняемая пользовательская правка — указанная настройка модуля через Foundry.

## Результаты проверок

### Подтверждённые успешные проверки

Из канонического каталога:

- `npm run check`: manifest/imports/syntax/assets корректны, **77 JavaScript-файлов**.
- `npm test`: **371 тест, 370 прошли, 0 ошибок, 1 пропущен**.
- Нативный Chromium production renderer: **17/17**. Изолированные Fade/Pulse/Slide по 2000 ms, настоящие UI-кнопки, повторный Pulse, различие эффектов, identity/isConnected, выход до скрытия, страницы, персонажи, быстрые команды, preference gates, rerender cancellation, очистка и полный combined pages-first цикл с возвратом к первому Actor.
- Настоящий Foundry ApplicationV2 в отдельном браузере на `/join`: **7/7**. Используется реальный класс v14.368 и стили Foundry; только тестовые данные в памяти. Это не выдаётся за авторизованный редактор мира.
- Дополнительно проверен **настоящий OverlayEditor в Electron, мир TEST, реальные Actor-привязки**. Измерения ниже получены после изменения существующей настройки, с прежними длительностями.

| Реальный эффект в Electron | Начало | Промежуточный sample | Завершение |
| --- | --- | --- | --- |
| Fade In, 600 ms, ease-out | opacity 0,0236 | opacity 0,6994 при ~308 ms | opacity 1 при 600 ms |
| Fade Out, 600 ms, ease-out | opacity 0,9764 | opacity 0,3006 при ~308 ms | opacity 0 при 600 ms, затем скрытие |
| Pulse, 1200 ms, ease-out | scale 1,0028 | scale 1,0739 при ~608 ms | scale 1 при 1200 ms |
| Вход Actor, половина общего перехода 600 ms | opacity 0,00145 | opacity 0,5479 при ~158 ms | opacity 1 при 300 ms |
| Вход страницы, slide-right, 400 ms | X ~47,96 px | X ~22,29 px, opacity 0,5356 при ~208 ms | X 0, opacity 1 |

Все перечисленные native samples имеют `connected: true`. Нелинейные промежуточные значения соответствуют easing, а не требованию opacity=0,5 ровно в середине.

Скриншоты отдельного production browser test также сравнены по пикселям. Между началом и серединой Fade In изменились **281 520 пикселей**, Pulse — **127 330 пикселей**. Таким образом, измерены не только вызовы и матрицы, но и изменившееся изображение. Результат — `work/animation-forensics/pixel-comparison.json`.

В **настоящем OBS** проверен источник Browser 3, сцена CAIN2, URL `http://localhost:30000/stream?mso=1`, размер 1920×1080. Источник отображает настоящую Actor-карточку. Команды идут через штатный транспорт: после Exit карточка отсутствует на кадре OBS при сохранённом фоне, после Entrance возвращается на прежнее место. Отправлены Pause/Pulse/Resume; карусель после проверки возобновлена. Стриминг и запись не запускались. Нативные снимки OBS показаны в чате, а не сохранены как файлы этого отчёта.

### Неуспешные/пропущенные проверки

- В окончательных прогонах ошибок нет. Единственный пропуск `npm test` — существующий тест symlink/junction: ОС не разрешает создать тестовую ссылку.
- Первый запуск диагностики ApplicationV2 остановился из-за неверного соединения URL после нормализации trailing slash в `getRoute()`. Исправлен **диагностический runner**, повторный запуск дал 7/7. Это не дефект анимационного движка.
- Первый запуск Chromium из песочницы не смог стартовать браузер; дальнейшие браузерные проверки выполнены вне неё с предоставленным разрешением. Ничего не устанавливалось.

### Не выполнено / пределы доказательств

- Не собраны `getComputedStyle()`, Animation.currentTime и точные промежуточные Fade/Pulse-кадры **внутри OBS CEF**. Подтверждение Pulse-команды и кадр после её окончания не доказывают промежуточное масштабирование в OBS. Эти измерения не объявляются пройденными.
- Не изменялись HP/другие поля настоящих Actor для стресс-теста live updates; сохранение привязок и отображение реальных данных проверены, а управление обновлениями покрывают существующие тесты.
- Не выполнен длительный OBS soak-тест, тест под GPU/CPU-нагрузкой и проверка каждого возможного стороннего модуля/CSS override.
- Дополнительная ручная вставка в DevTools оставалась заблокирована браузером; защита не обходилась. Основное native evidence получено через существующую панель diagnostics.

### Артефакты и повторный запуск

Из установленного корня, при доступном Playwright и Chromium:

```powershell
$env:MSO_PLAYWRIGHT_MODULE='C:/Users/Lev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:MSO_CHROMIUM_EXECUTABLE='C:/Users/Lev/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe'
node tools/animation-browser-check.mjs
node tools/animation-foundry-check.mjs
```

Второй runner требует работающий Foundry на порту 30000 с доступной `/join`; альтернативный адрес задаётся `MSO_FOUNDRY_URL`. Авторизация не автоматизируется. Оба runner завершают браузер и временный сервер, не записывают настройки Foundry и не изменяют Actors.

В `work/animation-forensics/` находятся `evidence.json`, `foundry-evidence.json`, кадры начала/середины/конца, `foundry-live-before.json`, `foundry-live-after.json` (Pulse и переходы), `foundry-live-exit.json`, `foundry-live-entrance.json`, `obs-observations.json`, `pixel-comparison.json`. Старые предупреждения reduced-motion могут оставаться в короткой истории существующей сессии; оценивать нужно timestamp последнего запроса.

## Ручная проверка

1. Открыть TEST как GM. **Настройки игры → Modular Stream Overlay**: **Enable overlay animations** включено, **Respect reduced motion** выключено для запрошенного анимированного вывода. Это уже применено. При намеренном включении Respect reduced motion мгновенные переключения являются ожидаемым поведением.
2. Обновить GM-клиент после исходных изменений и открыть **Open Overlay Editor**. Выбрать существующий оверлей/виджет, **Test output → Editor preview**, затем **Pause Carousel**. Не сбрасывать демо и не менять Actor-ссылки.
3. **Play Entrance Animation**: настроенный Fade In должен плавно показать всю карточку. **Play Exit Animation**: карточка должна исчезнуть после плавного уменьшения прозрачности. Снова Entrance возвращает её. Проверять существующие 600 ms; увеличивать сохранённую длительность для исправления не требуется.
4. **Play Pulse Animation** дважды с паузой: увеличивается вся карточка и возвращается к исходным координатам. После тестового Exit сначала нужен Entrance. Обычный скрытый слой нужно показать контролом видимости.
5. **Next Page / Previous Page**: информация меняется с настроенным slide. **Next Character / Previous Character**: имя, портрет и поля относятся к одному персонажу, виден отдельный Fade. **Resume Carousel**: проходит вся заданная combined-последовательность. При настройке другого типа перехода эффект должен отличаться; это меняет дизайн только по вашему намерению.
6. При включённом debug после завершения нажать **Refresh diagnostics**. Для последнего эффекта проверить `requested → started → sample → finished`, `connected: true`, нужную duration и промежуточный opacity/transform. `skipped` требует проверки `reason`; успешная отправка не заменяет эти данные.
7. Для OBS выбрать сохранённый оверлей в **Active on stream**, убедиться, что выделенный Player авторизован в **Browser Source → Interact**, и что источник видим. В панели выбрать **OBS (saved active overlay)**. Повторить Entrance/Exit/Pulse, Next Page и Next Character, наблюдая сам preview OBS. Локальный JSON под панелью остаётся диагностикой редактора, что явно указано интерфейсом.
8. В свойствах Browser Source оставить правильные 1920×1080 и разумный FPS (обычно 30/60); учитывать **Shutdown source when not visible** и **Refresh browser when scene becomes active**. После обновления исходников при необходимости один раз Refresh. Не менять аппаратное ускорение или системный reduced motion без отдельного воспроизводимого основания.
