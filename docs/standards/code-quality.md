# Стандарт качества кода

Обязательный стандарт качества кода для репозитория nessy-orch. Любое изменение, которое идёт в `feat/agentport-core`
и далее в `main`, проверяется по этому документу как по чек-листу. Отклонение от стандарта — блокирующая ошибка ревью,
а не рекомендация.

Стандарт исполняется автоматически: целиком вшит в `npm run check` (см. «Проверка»). Красный `check` — этап не принят
CI-гейтом и не мёржится.

## 1. Типизация

Конфигурация TypeScript — `tsconfig.json`, обязательные опции:

- `strict: true`;
- `noUncheckedIndexedAccess` — доступ по индексу/`[]` возвращает `T | undefined`;
- `exactOptionalPropertyTypes` — тип `prop?: T` запрещает присвоение `undefined`;
- `noImplicitOverride` — переопределение метода требует `override`;
- `noFallthroughCasesInSwitch` — запрет «проваливания» кейсов;
- дополнительно: `noUnusedLocals`/`noUnusedParameters`, `useUnknownInCatchVariables`.

ESLint — пресет `strictTypeChecked` (`typescript-eslint`), включая в явном виде:

- `no-explicit-any` — `any` запрещён;
- `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, `no-unsafe-assignment`,
  `no-unsafe-argument`, `no-unsafe-enum-comparison` — небезопасные операции запрещены;
- `ban-ts-comment` — `ts-ignore`/`ts-nocheck` запрещены; `ts-expect-error` — только
  с описанием причины в том же комментарии (лучше не использовать вовсе);
- `no-non-null-assertion` — `!` запрещён;
- `no-unnecessary-type-assertion` — избыточные приведения запрещены;
- `consistent-type-imports` — типы импортируются через `import type`;
- `no-floating-promises`, `no-misused-promises` — промисы не теряются.

Отклонения от типизации не допускаются. `eslint-disable` — только на конкретную строку (не на файл), с комментарием-обоснованием
и попадает в список исключений на ревью (см. «Ревью»).

## 2. Структура и границы слоёв

Код лежит в `src/{application,domain,infrastructure,interfaces,shared}`. Зависимости направлены строго вниз:

- `domain` — не зависит ни от кого (чистая логика без IO);
- `application` — зависит от `domain` и `shared`;
- `infrastructure` и `interfaces` — зависят от `application`, `domain` и `shared`.

Пересечение границы сверху вниз или вбок — ошибка. Нарушения ловит `eslint-plugin-boundaries` (правила
`boundaries/element-types`). Утилиты без зависимостей от слоёв — `src/lib/`.

Тесты зеркалят `src`: `test/unit/<слой>/...` повторяет структуру соответствующего каталога `src`.

## 3. Лимиты размера

- `max-lines`: 300 строк на файл. Превышение — файл нужно разбить, а не отключать правило.
- Функции длиннее 50 строк — рекомендация разбить.

## 4. Нейминги

`@typescript-eslint/naming-convention` (правила из стандарта):

- `camelCase` — переменные и функции;
- `PascalCase` — типы, классы, интерфейсы;
- `UPPER_SNAKE_CASE` — константы;
- `_`-префикс — приватные (приватные члены и «неиспользуемые» аргументы по `^_`);
- файлы — `kebab-case`.

## 5. Экспорты

- Только именованные экспорты; `export default` запрещён.
- Публичный API слоя — через `index.ts` на границе слоя.
- Глубокие импорты через границы слоёв (`src/application/...` из `infrastructure/...`) запрещены.

## 6. Формат

- Единый конфиг Prettier, без локальных переопределений в файлах.
- `prettier --check` входит в `npm run check`.

## 7. Проверка

`npm run check` собирает: `typecheck` (`tsc --noEmit`) → `lint` (ESLint strict + `eslint-plugin-boundaries` + нейминги +
лимиты) → `prettier --check` → тесты. Красный `check` = этап не принят.

Ревьюеры проверяют диф по этому документу как чек-листом: типизация, границы слоёв, лимиты, нейминги, экспорты, формат.
Случаи `eslint-disable` со строки — пункт «исключения» в ревью: обоснование принимается или изменение отклоняется.

## 8. Порядок введения

Стандарт вводится без «глушилок»: правила не отключаются под существующий код. Уже превышающие лимиты файлы
(`agent.ts` — 972 строки, `orchestrator.ts` — 487 строк) разбиваются на этапах P2/P3, а не помечаются исключениями.
Новые изменения соответствуют стандарту сразу.

## Текущее состояние (на момент введения)

Ниже — расхождения фактической конфигурации с целями выше; каждое закрывается отдельной задачей, до этого `check`
по соответствующему пункту может не падать:

- `tsconfig.json`: `exactOptionalPropertyTypes: false` — включить;
- `eslint.config.mjs`: `no-non-null-assertion: "warn"` (в `test/**` выключен) — ужесточить до `error`;
- нет Prettier — добавить конфиг и `prettier --check` в `npm run check`;
- нет `eslint-plugin-boundaries` — добавить и настроить правила границ слоёв;
- нет `@typescript-eslint/naming-convention` и `max-lines` — добавить в конфиг.