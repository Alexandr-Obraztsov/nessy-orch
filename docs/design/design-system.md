# nessy для macOS 26: дизайн-система

> **Правка палитры (2026-10-10, по решению пользователя, приоритетнее текста ниже).** Оранжевого/янтарного в интерфейсе нет.
> «Ждёт вас» = акцентный синий: глиф руки синий с мягкой пульсацией (Reduce Motion — без неё), бейдж у сессии — залитая синяя капсула,
> плашка запроса прав — синяя подложка 10 % (HC 16 %) с обводкой 0.5 pt синим 35 %. «Работает» — нейтральный: серое кольцо
> (`textSecondary` по `separator`), сегменты плана: выполнено `quiet`, текущий `textPrimary`, впереди `separator`.
> Ошибка и «заблокирован/не хватает данных» — красный (`xmark.octagon.fill`). Готово — тихий серый. Dock-бейдж — системный красный (только счётчик).
> Токены в коде: `attention` = `#0066D6` / `#4CA2FF` (как `accentText`), `attentionTint` = accent 10 %, `attentionStroke` = accent 35 %.
> Контраст: attention / attentionTint 4.7 (светлая) · 5.4 (тёмная); primary / attentionTint 14.6 · 12.7; secondary / attentionTint 5.5 · 5.7;
> кольцо «работает» (`textSecondary`) / surface 6.3 · 6.3. Строки таблиц §2 и §6 про янтарь ниже — устарели.
>
> **Дополнение (окно агента).** Под шапкой окна агента — закреплённая полоса этапа (не прокручивается, не зависит от вкладки):
> «Шаг 2 из 4 · …» + сегменты; без плана — «Работает 3:20 · Запускает команду · npm test» / «Нет новостей 1:05 · …»;
> у готового — «Все шаги выполнены · 4 из 4»; у ждущего — синяя «Ждёт решения · Шаг 4 из 4 · …». Тап — чеклист в «Итоге».
> Высота окна — по содержимому (мин. 280, макс. — до низа контента), прижато к верху, меняется пружиной без отскока.
>
> **Дополнение (навигация в стиле Finder/Dock macOS 26).** Сайдбар — системный плавающий (`NavigationSplitView`), строки «large»;
> тулбар без плоской полосы (`toolbarBackgroundVisibility(.hidden)`), вкладки — одна стеклянная капсула, «⋯» — отдельная;
> низ панели menu bar — стеклянная капсула «Открыть nessy» и круглые стеклянные кнопки в `GlassEffectContainer`.

Статус: решение, заменяет `Theme.swift` и раздел «Палитра» в `docs/native-app-design.md` (там терракота и serif — отменены).
Платформа: macOS 26, SwiftUI, Liquid Glass. Приложение — монитор: человек смотрит, разрешает/отклоняет, останавливает.

## 0. Что не так сейчас (по скриншотам)

| Экран | Проблема | Правило, которое её закрывает |
|---|---|---|
| «Требуют вас» | 7 синих prominent-кнопок на экране («Открыть», «Просмотрено» в каждой карточке), янтарная карточка с янтарным чипом внутри янтарной рамки | §1.3, §8.2: одна prominent-кнопка на экран; «Требуют вас» — только решения, результаты сюда не попадают |
| Сессия | Заголовок трижды: тулбар, H1, «claude-1 · 3 агента»; чип «выполнено · 3» дублирует сводку справа; кнопка «Завершить» без смысла для монитора | §8.1: заголовок только в тулбаре; сводка — одна строка |
| Строка агента | Роль-чип «Исполнитель» у каждого имени, текст «Все шаги выполнены (4)» рядом с работающим спиннером, прогресс оторван от шага | §8.2: роль — в окне агента; шаг и прогресс в одной строке |
| Окно агента | Шторка во всю высоту, пустая нижняя половина, зачёркнутый план (шум), карточка в карточке («План», «Итог» — две рамки) | §8.3: плавающая панель по контенту, одна поверхность, выполненные шаги серым без зачёркивания |
| Везде | Оранжевые бейджи счётчиков в сайдбаре, плашка «Оркестратор 2.0.0», стекло вокруг текстового контента | §2, §5: цвет только у «нужны вы»/ошибки; служебное — в меню и настройках |

## 1. Принципы

1. **Просто ≠ пусто.** Убираем повторы, а не смысл: у агента всегда видно «что делает, на каком шаге, сколько идёт». Роль, space, id — на уровень глубже (окно агента, подсказка).
2. **Цвет — только у того, что требует внимания.** Синий — «идёт работа» и главное действие, янтарь — «нужны вы», красный — ошибка. Всё остальное серое. Если на экране нет проблем, на нём один цвет.
3. **Одно главное действие на экран.** Ровно одна кнопка с заливкой там, где есть решение. Остальное — обычные кнопки или меню.
4. **Знакомое, а не придуманное.** Системные `NavigationSplitView`, `List`, `Picker(.segmented)`, тулбар, меню, `⌘`-клавиши. Своё — только строка агента и панель агента.
5. **Движение объясняет изменение.** Двигается то, что поменялось, и оттуда, откуда пришло: окно агента — справа, строка — в свою группу. Ничего не мигает «для живости»; вращается только работающий агент.
6. **Стекло — для управления, поверхность — для чтения.** Текст никогда не лежит на стекле.
7. **Каждое значение защищаемо.** Шаг 4 pt, все пружины из таблицы §7, все цвета из §2. Других чисел в коде нет.

## 2. Цвет

**Акцент — фиксированный синий nessy, не системный `accentColor`.** Почему: у статусов свои цвета; если пользователь выберет системный акцент
оранжевым или красным, «работает» сольётся с «нужны вы» и «ошибкой». Синий знаком (системный по умолчанию), холоден рядом с янтарём
и красным и не спорит с ними. Корень приложения: `.tint(DS.Palette.accent)`. Зелёного в интерфейсе нет: «выполнено» — серое, оно не требует внимания.

| Роль | Светлая | Тёмная | Где |
|---|---|---|---|
| `windowBackground` | `#F2F2F4` | `#1B1B1D` | фон под контентом |
| `surface` | `#FFFFFF` | `#232325` | группы списка, плитки, строки источников |
| `panel` | `#FFFFFF` | `#2A2A2D` | окно агента (на тон светлее surface в тёмной — «ближе») |
| `separator` | `#000` 10 % (≈`#E6E6E6`) | `#FFF` 10 % (≈`#39393B`) | волосяные линии 0.5 pt; HC — 28 % |
| `hover` | `#000` 4.5 % | `#FFF` 4.5 % | подсветка строки, нейтральный бейдж |
| `selection` | `#E3EEFC` | `#1B3354` | выбранная строка агента (окно открыто) |
| `textPrimary` | `#1D1D1F` | `#F2F2F4` | имена, основной текст |
| `textSecondary` | `#5F5F66` | `#A3A3AA` | шаг плана, инструмент, таймер |
| `textTertiary` | `#86868C` | `#76767C` | только плейсхолдеры и неактивное (не для смысла) |
| `accent` (заливка) | `#0A6CE0` | `#1F6FE0` | prominent-кнопка, прогресс, кольцо «работает» |
| `accentText` | `#0066D6` | `#4CA2FF` | ссылки, акцентный текст |
| `attention` «нужны вы» | `#A35C00` | `#FFB340` | глиф «ждёт», бейдж, счётчик |
| `attentionTint` | `#FFF4E0` | `#3A2B12` | фон блока решения |
| `danger` | `#C9001A` | `#FF5C52` | глиф ошибки, текст причины |
| `dangerTint` | `#FDECEC` | `#3A1C1C` | фон блока ошибки |
| `quiet` | `#8E8E93` | `#7C7C82` | глифы idle/done |

**Контраст WCAG 2.x** (посчитан скриптом; AA: текст ≥ 4.5, крупный текст и глифы ≥ 3):

| Пара | Светлая | Тёмная |
|---|---|---|
| primary / surface · bg · panel | 16.8 · 15.1 · 16.8 | 14.0 · 15.4 · 12.8 |
| secondary / surface · bg · panel | 6.3 · 5.7 · 6.3 | 6.3 · 6.9 · 5.7 |
| tertiary / surface (не для смыслового текста) | 3.6 | 3.5 |
| accentText / surface · selection | 5.4 · 4.6 | 5.9 · 4.8 |
| attention / surface · bg · attentionTint | 5.1 · 4.6 · 4.7 | 8.8 · 9.6 · 7.7 |
| danger / surface · panel · dangerTint | 6.0 · 6.0 · 5.3 | 5.2 · 4.7 · 5.1 |
| белый / accent (текст кнопки) | 4.96 | 4.76 |
| primary · secondary / selection | 14.4 · 5.4 | 11.4 · 5.1 |
| quiet (глиф) / surface | 3.3 | 3.8 |
| accent (заливка прогресса) / surface | 5.0 | 3.3 |

**Increase Contrast** (`accessibilityHighContrast*` в `NSColor(name:)`): secondary `#3A3A3F`/`#D0D0D5` (11.3/10.2), разделители 28 %, у групп обводка 1 pt.
Светлая/тёмная — только системная, своего переключателя темы нет.

## 3. Типографика

Только системные стили SF — macOS сама подставляет оптический размер (Text/Display) и трекинг по размеру; **ручной `.tracking()` запрещён**,
serif запрещён. Допущение: у macOS нет пользовательского Dynamic Type, но стили масштабируются вместе с системным размером
текста (Settings → Accessibility → Text size) — поэтому только `Font.TextStyle`, никаких `size:`.

| Роль | Стиль SwiftUI | Размер/вес | Трекинг SF (авто) | Интерлиньяж |
|---|---|---|---|---|
| Заголовок сессии | `navigationTitle` (тулбар) | 15 bold, система | −0.23 | — |
| Подзаголовок сессии | `navigationSubtitle` | 11 regular | +0.06 | — |
| Заголовок панели агента | `.title3.weight(.semibold)` | 15 semibold | −0.23 | — |
| Метрика (плитка) | `.title.weight(.semibold).monospacedDigit()` | 22 semibold | +0.35 (Display) | — |
| Заголовок группы | `.subheadline.weight(.semibold)` | 11 semibold, secondary | +0.06 | — |
| Имя агента | `.body.weight(.semibold)` | 13 semibold | −0.08 | — |
| Основной текст / итог | `.body` | 13 regular | −0.08 | `lineSpacing(3)` в итоге, 0 в строках |
| Вторичный (шаг, таймер) | `.callout` (+`monospacedDigit` у таймера) | 12 regular | 0 | 0 |
| Подпись | `.subheadline` | 11 regular | +0.06 | 0 |
| Моно (инструмент, команда) | `.system(.callout, design: .monospaced)` | 12 SF Mono | 0 | 2 в блоке команды |

Иерархия — весом, а не размером: в строке агента один semibold (имя), остальное regular. Числа, которые меняются, — `monospacedDigit`.

## 4. Сетка и размеры

Шаг **4 pt**: допустимы 4 · 8 · 12 · 16 · 20 · 24 · 32. Других отступов нет.

| Элемент | Значение |
|---|---|
| Окно: мин. размер / отступ контента | 900×600 / 20 по горизонтали, 16 сверху под тулбаром |
| Сайдбар | 200–320, по умолчанию 240 (`navigationSplitViewColumnWidth`) |
| Строка сайдбара | 28 pt (системный размер «средний»; «крупный» в системных настройках → 32) — одна строка текста |
| Строка агента | норма 2–3 строки текста: 52 (2 строки) / 68 (3); максимум 3 строки + блок решения (≈ 68 + 84) |
| Строка источника | 44 (две строки) · плитка статистики 88 |
| Окно агента | ширина 380–600, по умолчанию 440; отступ от краёв контента 8; высота — по содержимому, макс. — до низа окна |
| Радиусы | группа 12 → подсветка строки внутри = концентрично (12 − 4 = 8, через `ConcentricRectangle`); окно агента концентрично окну (минимум 18); кнопки и бейджи — капсула |
| Глифы состояния | 16 в строке агента · 14 в сайдбаре · 20 в шапке окна агента |
| Мини-прогресс | 48×3, капсула |
| Обводки | 0.5 pt (`hairline`), HC — 1 pt |

## 5. Материалы и глубина

| Слой | Материал | Примеры |
|---|---|---|
| Управление | **Liquid Glass** (системное или `glassEffect(.regular.interactive())`) | тулбар и его кнопки, `Picker` вкладок в тулбаре, сайдбар (системный), кнопки шапки окна агента, тост, панель menu bar |
| Контент | **непрозрачная поверхность** `surface`/`panel` | группы агентов, итог, журнал, источники, плитки |

- **Нет стекла на стекле**: внутри тоста и панели menu bar кнопки — `.borderless`/`.bordered`, не `.glass`. Несколько стеклянных кнопок рядом — в `GlassEffectContainer(spacing: 8)`.
- **Тинт** у стекла — только у одной главной кнопки (`.glassProminent` или `.tint(accent)`), и только в слое управления.
- **Края скролла**: `scrollEdgeEffectStyle(.soft, for: .top)` у списков под тулбаром — вместо линии-разделителя.
- **Тень** только у окна агента: `black 18 %, r 24, y 8` + контактная `black 8 %, r 2, y 1`. Группы теней не имеют — их отделяет обводка 0.5 pt.
- **Reduce Transparency**: системное стекло само становится матовым; наши поверхности и так непрозрачны. **Increase Contrast**: обводки групп и окна 1 pt, цвета — HC-варианты §2.

## 6. Состояния агента

Различаются формой и словом, цвет — третий канал.

| Состояние | SF Symbol | Цвет | Анимация | Подпись | Reduce Motion |
|---|---|---|---|---|---|
| `working` | кольцо с дугой 28 % (своё, не символ) | `accent` | вращение 1 об/с, linear | «Работает» | дуга стоит |
| `wait` | `hand.raised.fill` | `attention` | один `.bounce` при входе в состояние, дальше статично | «Ждёт вас» | без bounce |
| `error` | `xmark.octagon.fill` | `danger` | нет | «Ошибка» | — |
| `done` | `checkmark.circle` | `quiet` | `contentTransition(.symbolEffect(.replace))` при переходе | «Готово» | кросс-фейд |
| `idle` | `circle.dashed` | `quiet` | нет | «Ждёт поручения» | — |

Пульсаций нет: внимание держат цвет, место (группа «Ждут вас» сверху) и счётчик, а не мигание. Статус ответа `DONE_WITH_CONCERNS`
— бейдж «С оговорками» (`exclamationmark.triangle`, attention); `BLOCKED/NEEDS_CONTEXT` — состояние `wait` с причиной.

## 7. Движение

Все анимации — пружины без отскока (`dampingFraction 1.0`): ни одно взаимодействие не несёт инерции жеста, а отскок у появившейся
панели выглядит как ошибка. Все прерываемы: SwiftUI анимирует от текущего значения; повторный клик на середине закрытия разворачивает панель
обратно. Под **Reduce Motion** всё перемещение заменяется кросс-фейдом `easeInOut 0.15`.

| Взаимодействие | Анимация | Деталь |
|---|---|---|
| Открытие окна агента | `spring(response: 0.35, dampingFraction: 1.0)` | `opacity` + `offset(x: 24)` + `scale 0.98` от `.trailing`; выбранная строка подсвечивается тем же кадром |
| Закрытие окна агента | та же пружина, та же траектория обратно | уходит вправо, не вниз; Esc/⌘W/клик по пустому |
| Смена агента в открытом окне | `smooth(duration: 0.2)` | само окно не двигается, тело — кросс-фейд |
| Вкладки сессии / окна агента | системный `Picker`, тело — `smooth(0.2)` | без сдвига контента |
| Раскрытие группы | `snappy(duration: 0.25)` | шеврон 0→90°, строки — `opacity + move(.top)` |
| Строка меняет группу / появляется | `spring(response: 0.4, dampingFraction: 1.0)` | по `id`, строка «переезжает», а не пропадает |
| Блок решения раскрывается / сворачивается | `spring(0.35, 1.0)` | высота + opacity; после «Разрешить» глиф `replace` |
| Прогресс шага | `spring(response: 0.5, dampingFraction: 1.0)` | только рост; сброс при новом плане — без анимации |
| Счётчики (токены, бейджи) | `.contentTransition(.numericText(value:))` + `snappy(0.25)` | `monospacedDigit`, чтобы не дрожала ширина |
| Hover | вход `easeOut 0.12`, выход `easeOut 0.2` | только фон `hover`, без масштаба |
| Тост | `spring(0.35, 1.0)`, `move(.top) + opacity`, стекло `glassEffectTransition(.materialize)` | уходит туда же, наверх; 5 с, наведение держит |

## 8. Компоненты

### 8.1 Тулбар и вкладки сессии
- **Анатомия**: заголовок сессии (`navigationTitle`) + подзаголовок «3 агента · 12 мин» (`navigationSubtitle`) · по центру `Picker(.segmented)`: «Агенты · Источники · Статистика» · справа `⌘F` поиск. Всё — системное стекло тулбара.
- **Не показываем**: H1 в контенте, «claude-1», версию оркестратора, кнопку «Завершить» (сессию закрывает Claude; ручное — в меню «Сессия»).

### 8.2 Сайдбар
- **Сверху** пункт «Ждут вас» (`hand.raised`, счётчик справа — `attention`, только если > 0). Ниже «Сессии» (системный заголовок секции), «Завершённые» — свёрнутая секция.
- **Строка сессии** (28): глиф сводного состояния 14 (по худшему: error > wait > working > done) · название (`.body`, 1 строка, обрезка в конце) · справа число ждущих (только если > 0). Время, владелец, число агентов — в `help` (подсказке).
- **Состояния**: default / hover (система) / selected — системная заливка акцентом с белым текстом (знакомо) / disabled — нет. Связь с оркестратором — только при обрыве: строка внизу «Нет связи» (`danger`) + «Повторить».

### 8.3 Группа списка агентов
- Группы по смыслу, в этом порядке: **Ждут вас → Работают → Ошибки → Готово (свёрнута) → Ждут поручения**. Пустые группы не рисуются.
- Заголовок группы — вне поверхности: `groupTitle` + число (`DSCount`), шеврон у сворачиваемых. Тело — `dsGroup()`: surface, радиус 12, строки разделены `separator` с отступом слева 40 (под текст, не под глиф).

### 8.4 Строка агента
```
[глиф16]  ci-fixer                                   1:14     ← имя (agentName) · таймер (timer, secondary)
          Шаг 2 из 4 · Поправить maxDelay      ▬▬▬▭▭▭       ← secondary · мини-прогресс 48×3
          [▸] Bash  git push origin fix/retry-delay        ← символ инструмента (terminal, doc, globe…) + имя (secondary) + аргумент (mono, 1 строка)
```
- Отступы: 12 по вертикали, 12 слева, 16 справа; глиф — 16 по центру первой строки; текст с x = 40; межстрочно 4.
- **По состояниям**: working — 3 строки; wait — строки 1–2 + блок решения; error — строка 2 = причина (`danger`, 2 строки макс.); done — 2 строки: имя + первая строка итога (secondary); idle — 1 строка. Нет плана → строка 2 опускается.
- **Таймер** — время текущего хода; > 5 мин без событий — `attention` и подсказка «Нет событий 6 мин».
- **Состояния**: hover — фон `hover` (концентричный, вставка 4) · selected (окно открыто) — `selection` · pressed — система · disabled — нет. Клик/⏎ — открыть окно агента; ⌘. — остановить ход (контекстное меню).
- **Не показываем**: роль, space, id, поручение, число вызовов, текст «Все шаги выполнены (N)».

**Блок решения** (внутри строки, под строкой 2, вставка 12, радиус концентричный 8, фон `attentionTint`):
- «Просит выполнить» (`caption`, attention) · команда целиком `mono`, до 4 строк, «Показать целиком» · риск — одно предложение `secondary` с `exclamationmark.triangle` (только если риск есть).
- Кнопки справа: **«Разрешить»** `.borderedProminent` (единственная заливка на экране) · «Отклонить» `.bordered` · меню `…`: «Разрешать всегда для этой команды». ⌘⏎ / ⌘⌫.
- Несколько ждущих в одном экране: prominent только у первого, у остальных обе кнопки `.bordered`.

### 8.5 Окно агента (плавающая панель)
- **Где**: оверлей над контентом сессии справа, отступ 8 от краёв, ширина 440 (тянется за левый край 380–600), высота по содержимому; `dsPanel()` — непрозрачная поверхность с тенью, не стекло. Список под ним не затемняется и прокручивается (параллельная, а не модальная задача).
- **Шапка** (16 отступы): глиф 20 · имя (`panelTitle`) · справа стеклянные кнопки-иконки в `GlassEffectContainer`: «Открыть в окне» (`macwindow`), «Закрыть» (`xmark`). Под именем одной строкой: `Работает · Шаг 2 из 4 · 1:14` (secondary) и роль.
- **Переключатель**: `Picker(.segmented)` «Итог · Журнал» на всю ширину минус 32. По умолчанию «Итог», если ответ есть, иначе «Журнал».
- **Итог**: план (только если есть) — список шагов: выполненные `checkmark` + secondary (без зачёркивания), текущий — кольцо `working` + primary, будущие — tertiary-кружок; затем текст итога (`body`, lineSpacing 3, markdown); затем источники строками §8.7; внизу одна строка `1 ход · 4 вызова · 2.8 к токенов` (`caption`, secondary). Одна поверхность, без вложенных карточек; разделы — заголовком `groupTitle` и отступом 24.
- **Журнал**: лента событий, подряд идущие вызовы инструментов схлопнуты («Bash × 6»), вывод — моно, обрезан до 6 строк. Якорь к низу, только если пользователь внизу.
- **Действия**: «Копировать итог» — иконка в шапке при вкладке «Итог»; «Остановить» — в меню `…`. Без prominent-кнопок, кроме блока решения (как в строке).

### 8.6 Плитка статистики
- Сетка 4 колонки (`LazyVGrid`, адаптивно от 160), плитка 88: число (`metric`, `DSCount`) сверху, подпись (`caption`, secondary) снизу, отступы 16, `dsGroup()`.
- Плитки: Токены (вход/выход/кэш — в подсказке), Ходы, Вызовы инструментов, Время. Ниже — таблица по агентам (`Table`, сортировка). Цвета нет.

### 8.7 Строка источника
- 44: символ вида 16 (`chevron.left.forwardslash.chevron.right` GitLab, `checklist` Jira, `book` Wiki, `doc.text` файл, `globe` сеть) · заголовок (`body`, 1 строка) · под ним адрес (`caption`, secondary, обрезка в середине) · справа «3 агента» (`caption`).
- Hover — `hover` + `arrow.up.right`; клик открывает ссылку; контекстное меню «Скопировать ссылку». Без чипов-капсул.

### 8.8 Бейдж и счётчик
- `DSBadge`: капсула, `caption.medium`, слово + символ. Заливка цветом только у attention/danger; нейтральный — `hover`. Бейджей ролей и «выполнено · N» нет.

### 8.9 Кнопки
| Стиль | Где |
|---|---|
| `.borderedProminent` | одно главное действие в контенте («Разрешить») |
| `.bordered` | второстепенные действия в контенте («Отклонить») |
| `.glass` / `.glassProminent` | только плавающее управление (шапка окна агента, тост); prominent — максимум одна |
| `.borderless` / `.plain` | иконки в строках, «Показать целиком», ссылки |
Размер — `controlSize(.regular)`; в блоке решения `.large` не используется.

### 8.10 Тост
- Сверху по центру под тулбаром, ширина по тексту (макс. 480), капсула стекла `glassEffect(.regular)`. Глиф состояния + «ci-fixer просит разрешение» + `.borderless`-кнопка «Показать». Один тост за раз, новые заменяют.
- Системные уведомления (вне приложения): категории «Ждёт вас» (кнопки «Разрешить»/«Отклонить»), «Ошибка», «Сессия завершена». Результаты — без уведомления, только бейдж Dock.

### 8.11 Menu bar
- Значок: `hand.raised.fill` + число, если кто-то ждёт; `xmark.octagon` при ошибке; иначе монохромный логотип (template). Панель — те же строки агента §8.4 (только «Ждут вас» и «Работают»), внизу «Открыть nessy».

### 8.12 Пустые состояния
- `ContentUnavailableView`: символ + одна фраза + одно действие. «Сессий нет — их заводит Claude: `nessy-orch session new`» (кнопка «Скопировать команду»); «Никто не ждёт» (без действия); «Источников пока нет»; «Нет связи с оркестратором» + «Повторить». Никаких иллюстраций.

## 9. Swift-токены: `DesignSystem.swift`

Проверено: `swiftc -typecheck -swift-version 6 -target arm64-apple-macos26.0` и `swift build` проекта с файлом в `Sources/NessyOrch/` — собирается
рядом с текущим `Theme.swift` (имена в пространстве `DS`, без конфликтов). Переход: экраны переводятся на `DS.*`, затем `Theme.swift` удаляется.
Связка с моделью: `extension AgentState { var ds: DS.AgentState }` (`starting` → `.working`).

```swift
import SwiftUI
import AppKit

/// Дизайн-система nessy (docs/design/design-system.md). Цвет — только у того, что требует внимания.
enum DS {
	enum AgentState { case idle, working, wait, error, done }
	enum Tone { case neutral, accent, attention, danger }
}

// MARK: - Цвет

extension DS {
	enum Palette {
		static let windowBackground = Color.ds(0xF2F2F4, 0x1B1B1D)
		static let surface = Color.ds(0xFFFFFF, 0x232325)
		static let panel = Color.ds(0xFFFFFF, 0x2A2A2D)
		static let separator = Color.ds(0x000000, 0xFFFFFF, alpha: 0.10, hcAlpha: 0.28)
		static let hover = Color.ds(0x000000, 0xFFFFFF, alpha: 0.045, hcAlpha: 0.08)
		static let selection = Color.ds(0xE3EEFC, 0x1B3354)
		static let textPrimary = Color.ds(0x1D1D1F, 0xF2F2F4, hc: (0x000000, 0xFFFFFF))
		static let textSecondary = Color.ds(0x5F5F66, 0xA3A3AA, hc: (0x3A3A3F, 0xD0D0D5))
		static let textTertiary = Color.ds(0x86868C, 0x76767C, hc: (0x5F5F66, 0xA3A3AA))
		static let accent = Color.ds(0x0A6CE0, 0x1F6FE0)
		static let accentText = Color.ds(0x0066D6, 0x4CA2FF, hc: (0x004FA8, 0x7DBBFF))
		static let attention = Color.ds(0xA35C00, 0xFFB340, hc: (0x7A4500, 0xFFC870))
		static let attentionTint = Color.ds(0xFFF4E0, 0x3A2B12)
		static let danger = Color.ds(0xC9001A, 0xFF5C52, hc: (0x9E0014, 0xFF8A82))
		static let dangerTint = Color.ds(0xFDECEC, 0x3A1C1C)
		static let quiet = Color.ds(0x8E8E93, 0x7C7C82, hc: (0x5F5F66, 0xA3A3AA))

		static func tone(_ t: Tone) -> Color {
			switch t {
			case .neutral: textSecondary
			case .accent: accentText
			case .attention: attention
			case .danger: danger
			}
		}
	}
}

extension Color {
	/// Динамический цвет: светлая/тёмная тема и «Увеличить контраст» (hc) — через NSColor(name:).
	static func ds(_ light: UInt32, _ dark: UInt32, alpha: Double = 1, hcAlpha: Double? = nil, hc: (UInt32, UInt32)? = nil) -> Color {
		Color(nsColor: NSColor(name: nil) { appearance in
			let match = appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua])
			let isDark = match == .darkAqua || match == .accessibilityHighContrastDarkAqua
			let isHC = match == .accessibilityHighContrastAqua || match == .accessibilityHighContrastDarkAqua
			let hex = isHC ? (hc.map { isDark ? $0.1 : $0.0 } ?? (isDark ? dark : light)) : (isDark ? dark : light)
			let a = isHC ? (hcAlpha ?? alpha) : alpha
			return NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
						   blue: CGFloat(hex & 0xFF) / 255, alpha: CGFloat(a))
		})
	}
}

// MARK: - Типографика (только системные стили: трекинг и оптический размер подставляет SF)

extension DS {
	enum Typography {
		static let panelTitle = Font.title3.weight(.semibold)
		static let groupTitle = Font.subheadline.weight(.semibold)
		static let agentName = Font.body.weight(.semibold)
		static let body = Font.body
		static let secondary = Font.callout
		static let caption = Font.subheadline
		static let mono = Font.system(.callout, design: .monospaced)
		static let metric = Font.title.weight(.semibold).monospacedDigit()
		static let timer = Font.callout.monospacedDigit()
		static let readingLineSpacing: CGFloat = 3
	}
}

// MARK: - Сетка и размеры (шаг 4 pt)

extension DS {
	enum Metrics {
		static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20, s6: CGFloat = 24, s8: CGFloat = 32
		static let contentInset: CGFloat = 20
		static let sidebarWidth: (min: CGFloat, ideal: CGFloat, max: CGFloat) = (200, 240, 320)
		static let agentPanelWidth: (min: CGFloat, ideal: CGFloat, max: CGFloat) = (380, 440, 600)
		static let panelInset: CGFloat = 8
		static let groupRadius: CGFloat = 12
		static let rowInset: CGFloat = 4
		static let panelRadiusFallback: CGFloat = 18
		static let glyphRow: CGFloat = 16, glyphSidebar: CGFloat = 14, glyphHeader: CGFloat = 20
		static let progressSize = CGSize(width: 48, height: 3)
		static let hairline: CGFloat = 0.5
	}
}

// MARK: - Движение (всё критически задемпфировано; без отскоков — нет жестов с инерцией)

extension DS {
	enum Motion {
		static let panel = Animation.spring(response: 0.35, dampingFraction: 1.0)
		static let layout = Animation.spring(response: 0.4, dampingFraction: 1.0)
		static let disclosure = Animation.snappy(duration: 0.25)
		static let progress = Animation.spring(response: 0.5, dampingFraction: 1.0)
		static let counter = Animation.snappy(duration: 0.25)
		static let fade = Animation.smooth(duration: 0.2)
		static let hoverIn = Animation.easeOut(duration: 0.12)
		static let hoverOut = Animation.easeOut(duration: 0.2)
		static let reduced = Animation.easeInOut(duration: 0.15)

		static func pick(_ a: Animation, reduceMotion: Bool) -> Animation { reduceMotion ? reduced : a }

		/// Окно агента: приходит справа и уходит туда же (симметрично).
		static func panelTransition(reduceMotion: Bool) -> AnyTransition {
			reduceMotion ? .opacity : .opacity.combined(with: .offset(x: 24)).combined(with: .scale(scale: 0.98, anchor: .trailing))
		}

		static func rowTransition(reduceMotion: Bool) -> AnyTransition {
			reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top))
		}
	}
}

// MARK: - Модификаторы

extension View {
	/// Контентная группа: непрозрачная поверхность + волосяная обводка. Внутренние формы — концентричные.
	func dsGroup() -> some View {
		let shape = RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous)
		return self
			.background(DS.Palette.surface, in: shape)
			.overlay(shape.strokeBorder(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
			.containerShape(shape)
	}

	/// Плавающее окно агента: непрозрачная поверхность, тень, форма концентрична окну.
	func dsPanel() -> some View {
		let shape = ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.panelRadiusFallback)), isUniform: true)
		return self
			.background(DS.Palette.panel, in: shape)
			.clipShape(shape)
			.overlay(shape.stroke(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
			.shadow(color: .black.opacity(0.18), radius: 24, y: 8)
			.shadow(color: .black.opacity(0.08), radius: 2, y: 1)
	}

	/// Стекло — только слой управления (тосты, плавающие кнопки). Тинт — только у главного действия.
	func dsControlGlass(prominent: Bool = false) -> some View {
		self.glassEffect(.regular.tint(prominent ? DS.Palette.accent : nil).interactive(), in: Capsule())
	}

	func dsHover() -> some View { modifier(DSHover()) }
}

private struct DSHover: ViewModifier {
	@State private var hovering = false
	func body(content: Content) -> some View {
		content
			.background(hovering ? DS.Palette.hover : .clear, in: ConcentricRectangle())
			.onHover { h in withAnimation(h ? DS.Motion.hoverIn : DS.Motion.hoverOut) { hovering = h } }
	}
}

// MARK: - Примитивы

/// Глиф состояния: форма различает состояния без цвета; движется только «работает».
struct DSStateGlyph: View {
	var state: DS.AgentState
	var size: CGFloat = DS.Metrics.glyphRow
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var spin = false

	var body: some View {
		Group {
			switch state {
			case .working:
				ZStack {
					Circle().stroke(DS.Palette.accent.opacity(0.22), lineWidth: size * 0.14)
					Circle().trim(from: 0, to: 0.28)
						.stroke(DS.Palette.accent, style: StrokeStyle(lineWidth: size * 0.14, lineCap: .round))
						.rotationEffect(.degrees(spin ? 360 : 0))
				}
				.padding(size * 0.07)
				.onAppear { if !reduceMotion { withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { spin = true } } }
			case .wait:
				Image(systemName: "hand.raised.fill").foregroundStyle(DS.Palette.attention)
					.symbolEffect(.bounce, options: .nonRepeating, isActive: !reduceMotion)
			case .error:
				Image(systemName: "xmark.octagon.fill").foregroundStyle(DS.Palette.danger)
			case .done:
				Image(systemName: "checkmark.circle").foregroundStyle(DS.Palette.quiet)
			case .idle:
				Image(systemName: "circle.dashed").foregroundStyle(DS.Palette.quiet)
			}
		}
		.font(.system(size: size, weight: .medium))
		.frame(width: size, height: size)
		.accessibilityHidden(true)
	}
}

/// Бейдж: слово + (необязательно) символ; заливка только у attention/danger.
struct DSBadge: View {
	var text: String
	var tone: DS.Tone = .neutral
	var systemImage: String?
	var body: some View {
		Label {
			Text(text)
		} icon: {
			if let systemImage { Image(systemName: systemImage) }
		}
		.labelStyle(.titleAndIcon)
		.font(DS.Typography.caption.weight(.medium))
		.foregroundStyle(DS.Palette.tone(tone))
		.padding(.horizontal, DS.Metrics.s2).padding(.vertical, 2)
		.background(background, in: Capsule())
	}
	private var background: Color {
		switch tone {
		case .attention: DS.Palette.attentionTint
		case .danger: DS.Palette.dangerTint
		case .neutral, .accent: DS.Palette.hover
		}
	}
}

/// Мини-прогресс шага плана (48×3), растёт пружиной.
struct DSProgress: View {
	var fraction: Double
	var body: some View {
		ZStack(alignment: .leading) {
			Capsule().fill(DS.Palette.separator)
			Capsule().fill(DS.Palette.accent)
				.frame(width: max(DS.Metrics.progressSize.height, DS.Metrics.progressSize.width * min(max(fraction, 0), 1)))
		}
		.frame(width: DS.Metrics.progressSize.width, height: DS.Metrics.progressSize.height)
		.animation(DS.Motion.progress, value: fraction)
		.accessibilityValue(Text("\(Int(fraction * 100)) %"))
	}
}

/// Счётчик: цифры меняются «прокруткой» (numericText), моноширинные.
struct DSCount: View {
	var value: Int
	var body: some View {
		Text(value, format: .number).monospacedDigit()
			.contentTransition(.numericText(value: Double(value)))
			.animation(DS.Motion.counter, value: value)
	}
}
```

## 10. Чек-лист приёмки

1. На экране без проблем — **один** хроматический цвет (синий: точка «новое», ссылки); синие плашки «ждёт вас» и красный — только вместе с ждущим/ошибкой.
2. Зелёного, оранжевого и янтаря нет нигде, включая бейджи и иконки.
3. На экране **не больше одной** кнопки с заливкой (`borderedProminent`/`glassProminent`).
4. Заголовок сессии виден ровно **один раз** (тулбар).
5. Все отступы и размеры кратны 4; все радиусы — 12, концентричные или капсула.
6. Стекло только в тулбаре, сайдбаре, шапке окна агента, тосте, menu bar; ни один абзац текста не лежит на стекле; нет стекла внутри стекла.
7. Состояния агента различимы в оттенках серого (скриншот в grayscale): кольцо, рука, восьмиугольник, галочка, пунктир.
8. Строка агента — не больше 3 строк текста (+ блок решения); роль и id в строке не видны.
9. Все пары текст/фон из §2 ≥ 4.5:1 в обеих темах; tertiary не несёт смысла.
10. Окно агента открывается и закрывается по одной траектории (справа), прерывается кликом посреди анимации без рывка.
11. С Reduce Motion ничего не двигается — только кросс-фейды; спиннер стоит.
12. С Increase Contrast обводки 1 pt, вторичный текст ≥ 10:1.
13. Нет `.tracking()`, `Font.system(size:)`, serif и hex-цветов вне `DS.Palette`.
14. Числа, которые меняются (таймер, токены, счётчики), — `monospacedDigit` и `numericText`; ширина строки не дрожит.
15. Каждое пустое состояние — символ, фраза и не больше одного действия.
16. В окне агента под шапкой всегда видна полоса этапа (шаг + сегменты / инструмент и время / «Все шаги выполнены» / «Ждёт решения»).
17. Окно агента по высоте — по содержимому (≥ 280), прижато к верху; под коротким окном виден фон контента.
