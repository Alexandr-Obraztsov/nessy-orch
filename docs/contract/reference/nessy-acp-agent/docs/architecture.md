# Architecture Guide

Слоение `nessy-acp-agent` и правила импортов между слоями. Правила
автоматически проверяются ESLint (`eslint-plugin-boundaries`, правило
`boundaries/dependencies`) — каждый новый импорт через границу слоя
блокируется и pre-commit хуком, и CI (`npm run lint`).

- [Layers](#layers) — что где живёт
- [Dependency matrix](#dependency-matrix) — что кому можно импортировать
- [Adding a new file](#adding-a-new-file) — куда положить новый модуль
- [Handling violations](#handling-violations) — как помечать существующие
- [Pitfalls](#pitfalls) — нюансы конфига
- [Source of truth](#source-of-truth) — где смотреть актуальные правила

---

## Layers

```
adapter (adapter/, auth/, mcp/)   ← transport-tier; знает обо всём
   │
   ├── commands                   ← оркестраторы use-case'ов
   │      │
   │      ├── domain (tools/, skills/, metadata/)   ← shared контракты
   │      │      │
   │      │      └── core         ← runtime: session, events, turn, command runner
   │      │             │
   │      │             ├── errors  ← типизированные ошибки
   │      │             │     │
   │      │             │     └── utils  ← листья, без внутренних зависимостей
   │      │             │
   │      │             └── utils
   │      │
   │      └── (всё ниже)
   │
   └── (всё ниже)
```

Один и тот же ESLint-элемент `adapter` покрывает три каталога —
`src/adapter/`, `src/auth/`, `src/mcp/`. Они трактуются как один transport-tier
(между собой свободно импортируют). То же про `domain` — это
`src/tools/`, `src/skills/`, `src/metadata/`.

Вне слоения:

- `src/index.ts` — точка сборки приложения, может импортировать всё.
- `src/types.ts` — общие типы; импортируется отовсюду.
- `src/__tests__/**` — тесты не подчиняются правилам границ.

### A2A adapter (`adapter/a2a/`)

`a2a-client-factory.ts` загружает agent card по переданному URL и передаёт её
в `helper/create-client.ts`, который выбирает протокол и создаёт клиент.
SDK нормализует старые карточки с `url` и
`protocolVersion` в `supportedInterfaces`; для старой карточки без версии
используется A2A 0.3. Среди поддерживаемых JSONRPC / HTTP+JSON интерфейсов
major `0` выбирает `v1`, major `1` — `v2`, независимо от minor и patch.
Если доступны оба major, предпочтение отдаётся `1`; другие major отклоняются.
Версия в пути URL не участвует в выборе.

- `v1/create-client.ts` — legacy-транспорты SDK с wire-форматом A2A 0.3.
  Они создаются явно: автоматический `legacyCompat` SDK ограничен диапазоном от 0.3 до 1.0.
- `v2/create-client.ts` — транспорты SDK с wire-форматом A2A 1.0.
- Общий bridge, преобразование данных, ошибки и retry находятся
  прямо в `adapter/a2a/`; `utils.ts` содержит преобразование данных стрима и разбор состояний задач.
- `helper/` — существующие помощники адаптера, включая server tool lifecycle.

Обе версии возвращают `IAgentBridge` и доменные `TStreamEvent`. Контракты
остаются в `core/session/types.ts` и `core/turn-types.ts` и не зависят от типов SDK.
Режимы agent card читает `utils/readAgentModes.ts`. Обработка prompt content и разбор
MCP-имён живут в `adapter/a2a/utils.ts`.

### Permission layer (`core/permission/`)

Подсистема разрешений живёт в `core/permission/` и состоит из:

- **types.ts** — контракты: `IRule`, `IRulesSnapshot`, `TPermissionDecision`, `IPermissionOption`
- **permission-storage.ts** — файловое хранилище правил (`project`/`user` scopes)
- **permission-service.ts** — сервис разрешения: extended-mode (storage + guards) vs legacy-mode (session cache)
- **permission-policy.ts** — политика: какие инструменты требуют разрешения
- **helpers/** — чистые функции: `classifyTool`, `matchRule`, `evaluatePermission`, `buildOptions`, виртуальные инструменты (FS, terminal, MCP, unknown)
- **guards/** — guard-объекты: G1 (sensitive paths), G2 (destructive commands), G3 (command substitution)

Extended-mode алгоритм (`resolveExtended`):

1. Permissionless tools → `allow_once` (без запроса)
2. Snapshot storage rules (`project` + `user`)
3. Guards → block/ask
4. Rules evaluation (deny-before-allow, project-before-user)
5. Prompt with per-category options (или autoApprove short-circuit для MCP)

---

## Dependency matrix

| From ↓ \ To → | utils | errors | core | domain | commands | adapter |
| ------------- | :---: | :----: | :--: | :----: | :------: | :-----: |
| **utils**     |   ✓   |   ✗    |  ✗   |   ✗    |    ✗     |    ✗    |
| **errors**    |   ✓   |   ✓    |  ✗   |   ✗    |    ✗     |    ✗    |
| **core**      |   ✓   |   ✓    |  ✓   |   ✓    |    ✗     |    ✗    |
| **domain**    |   ✓   |   ✓    |  ✓   |   ✓    |    ✗     |    ✗    |
| **commands**  |   ✓   |   ✓    |  ✓   |   ✓    |    ✓     |    ✓    |
| **adapter**   |   ✓   |   ✓    |  ✓   |   ✓    |    ✓     |    ✓    |

Симметрия `core ↔ domain` намеренная: `tools/types.ts` и подобные файлы
функционируют как shared контракты, к которым core привязан по построению.

---

## Adding a new file

Решение «куда положить» сводится к одному вопросу: **от чего ваш модуль
зависит?**

| Хотите импортировать только…                  | Положите в…  |
| --------------------------------------------- | ------------ |
| `node:*` / npm — ничего внутреннего           | `utils/`     |
| + `utils/`                                    | `errors/`    |
| + `errors/` (runtime/runtime-types)           | `core/`      |
| + `core/` (типы tool'ов, скиллов, метаданных) | `domain/`\*  |
| + `domain/` (оркестрация use-case'а)          | `commands/`  |
| + `commands/` (мост к внешнему транспорту)    | `adapter/`\* |

\* `domain/` — это `tools/` / `skills/` / `metadata/`. `adapter/` — это
`adapter/` / `auth/` / `mcp/`. Выбирайте каталог по семантике (новый
инструмент → `tools/`; работа с MCP-протоколом → `adapter/mcp/`; и т. д.).

Если хочется импортировать «вверх» (например, util-функция тянет тип
из core) — это сигнал, что модуль не на своём месте. Поднимите его
наверх или переименуйте.

---

## Handling violations

Существующие нарушения помечены inline-комментарием:

```ts
// eslint-disable-next-line boundaries/dependencies -- TODO(arch): <причина>
import ... from '...';
```

Они грепаются:

```bash
grep -rn "TODO(arch)" src/
```

Бойскаут: если редактируете файл с таким комментарием — попробуйте
исправить нарушение (обычно: перенести интерфейс в более низкий слой
или сам файл — в более высокий). После исправления удалите disable-
комментарий; ESLint поймает регрессию автоматически.

Новые нарушения **не должны** появляться. Если уверены, что слой для
вашего случая не подходит — обсудите с командой и расширьте матрицу в
`eslint.config.mjs`, а не добавляйте новые `eslint-disable-next-line`.

---

## Pitfalls

- **Same-tier bundles**: `adapter`/`auth`/`mcp` — один элемент. Чтобы
  `mcp-hub.ts` мог импортировать `adapter/a2a/a2a-errors.js`, в правилах для
  `adapter` явно прописан `adapter` в allow-list. Аналогично для
  `domain`. Если меняете матрицу — не забудьте эту самопеределку.
- **Path resolution**: ESM-стиль `.js`-импортов (`from '../foo.js'`)
  разрешается в `.ts`-исходник через `eslint-import-resolver-typescript`.
  Если поднимаете TS-конфиг (e.g. `paths`/`baseUrl`), убедитесь, что
  `import/resolver.typescript.project` в `eslint.config.mjs` указывает
  на правильный `tsconfig.json`.
- **`src/index.ts` / `src/types.ts`** в `boundaries/ignore` — добавьте
  файл туда, только если он действительно composition root или shared-
  types на уровне всего пакета. Не используйте ignore как замену для
  настоящего слоя.
- **Не путайте с error-handling rules** (`nessy/no-bare-throw-errors`
  и т. п.). Эти правила про типы ошибок (см. `docs/error-handling.md`),
  а `boundaries/dependencies` — про направление импортов.

---

## Source of truth

- `nessy-acp-agent/eslint.config.mjs` — определения элементов
  (`boundaries/elements`) и матрица правил (`boundaries/dependencies`).
  При любых сомнениях смотрите туда — этот документ может отставать.
- `nessy-acp-agent/.githooks/pre-commit` — gate. Запускает
  `eslint --max-warnings 0` на staged TS-файлах.
- `npm run lint:eslint` — локальная проверка всего `src/`.

Если правила меняются:

1. Обновить матрицу в `eslint.config.mjs`.
2. Прогнать `npm run lint:eslint`, убедиться, что число нарушений
   соответствует ожиданиям.
3. Обновить эту таблицу.
