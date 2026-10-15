# Каталог компонентов

Готовая разметка под `assets/styles.css`. Берите нужное, остальное не добавляйте: карточка, цифры и цвет должны что-то значить.
Все цвета и шрифты идут через токены (`var(--accent)` и т. д.), литералы цвета в HTML не пишите.

## Когда что

| Содержимое | Компонент |
|---|---|
| План, этапы, порядок действий | `steps` + `progress` |
| Что произошло и когда | `timeline` |
| Сравнение чисел по одной шкале | `bars` |
| Несколько однородных записей с полями | таблица `data` |
| Факты об одном объекте | `kv` |
| Решение, риск, предупреждение | `callout` |
| Длинное второстепенное | `details.fold` |
| Две-три равные части рядом | `cols` + `card` |
| Цифры, из которых состоит смысл страницы (не для украшения) | `tiles` |

## Шапка
Уже есть в `base.html`: `eyebrow` (вид документа: «План», «Отчёт», «Сводка»), заголовок, подзаголовок, метки. Статус страницы: `pill` с `good`/`warn`/`bad`/`info`, `done` (галочка) или `active` (пульс).

## Прогресс и шаги плана
Состояния шага: `done`, `active`, `blocked`, без класса (впереди). Номер или значок в `.mark` ставьте только у шагов, порядок которых важен.
```html
<div class="progress"><span>2 из 5</span><div class="track"><div class="fill" style="width:40%"></div></div><span>40%</span></div>
<ol class="steps">
  <li class="step done"><span class="mark">✓</span><div class="title">Собрать требования</div><div class="side"><span class="pill good done">Готово</span></div></li>
  <li class="step active"><span class="mark">2</span><div class="title">Спроектировать API</div>
    <div class="side"><span class="pill info active">В работе</span></div>
    <div class="detail">Два эндпоинта: создание сессии и сводка.</div>
    <div class="sub"><span>Исполнитель: <b>executor</b></span><span>Оценка: 2 ч</span></div></li>
  <li class="step"><span class="mark">3</span><div class="title">Тесты</div></li>
  <li class="step blocked"><span class="mark">!</span><div class="title">Выкатка</div><div class="side"><span class="pill bad">Ждёт ключ</span></div></li>
</ol>
```

## Хронология
```html
<ul class="timeline">
  <li><time>12:04</time><b>Упал pipeline #48213</b><span class="muted">Шаг test, 3 теста.</span></li>
</ul>
```

## Таблица
Широкая таблица остаётся внутри `.scroll`. Числа выравнивайте вправо классом `num`.
```html
<div class="scroll"><table class="data"><thead><tr><th>Задача</th><th>Статус</th><th class="num">Часы</th></tr></thead>
<tbody><tr><td>PLAT-77 Миграция</td><td><span class="pill warn">Ревью</span></td><td class="num">6</td></tr></tbody></table></div>
```

## Пары «ключ — значение»
```html
<dl class="kv"><dt>Ветка</dt><dd><code>fix/ci</code></dd><dt>Автор</dt><dd>Анна</dd></dl>
```

## Врезки
`callout` (инфо), `callout warn`, `callout bad`, `callout good`. Заголовок врезки — `.t`.
```html
<div class="callout warn"><span class="t">Риск</span><span>Миграция блокирует таблицу на минуты.</span></div>
```

## Колонки и карточки
```html
<div class="cols"><div class="card"><h3>Вариант A</h3><p>…</p></div><div class="card"><h3>Вариант B</h3><p>…</p></div></div>
```

## Столбики (одна шкала на все строки)
`width` в процентах от общего максимума, подпись справа — настоящее значение.
```html
<div class="bars"><div class="bar"><span class="name">api</span><span class="rail"><i style="width:80%"></i></span><span class="val">240 мс</span></div></div>
```

## Цифры
```html
<div class="tiles"><div class="tile"><span class="num">12</span><span class="label">открытых задач</span></div></div>
```

## Чек-лист, код, свёртка, оглавление
```html
<ul class="checks"><li><input type="checkbox" id="c1"><label for="c1">Проверить миграцию</label></li></ul>
<pre class="code">npm run check</pre>
<pre class="code diff"><span class="del">- старая строка</span>
<span class="add">+ новая строка</span></pre>
<details class="fold"><summary>Подробности</summary><p>…</p></details>
<nav class="toc"><a href="#summary">Кратко</a><a href="#plan">План</a></nav>
```

## Диаграммы
Для схем используйте таблицу, `steps` или `timeline`. Mermaid в локальном файле работает только с подключённым скриптом:
`<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"></script>` и `<pre class="mermaid">…</pre>`; без сети схема не покажется, поэтому рядом оставляйте текстовое описание.

## Правила вёрстки
- Секции идут сверху вниз: сначала вывод («Кратко»), потом детали.
- Состояние передавайте формой и подписью, а не только цветом (`pill` уже содержит значок).
- Одна карточка — один объект; не оборачивайте в карточки всё подряд.
- Тексты на странице короткие и конкретные, на языке пользователя; никакого lorem ipsum и эмодзи-маркеров.
- Ссылки на источники — настоящие `<a href>`; пути к файлам — в `<code>`.
