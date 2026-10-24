/** Справка CLI оркестратора. */
export const HELP = `nessy-orch — оркестратор агентов nessy

АГЕНТЫ
  spawn [--session S] [--name N] [--title "заголовок"] [--role R] [--runtime nessy-sdk|tclaude] [--model M] [--no-wait] [--timeout СЕК] "задача"
                       создать агента и отправить задачу; --runtime — рантайм (по умолчанию nessy-sdk),
                       --model — модель рантайма. Ждёт ответ (код 3 — не дождались: wait), --no-wait — вернуться сразу.
  send <агент|you> "текст" [--no-wait] [--interrupt] [--timeout СЕК] [--from ID]
                       отправить сообщение и дождаться ответа; --from — от имени агента
  wait <агент> [--timeout СЕК]   дождаться освобождения агента и вывести его последний ответ
  ask <путь|пространство> "задача" [--session S]   короткий spawn в другом каталоге
  ls [--all] [--session S]   дерево агентов: субагенты, рантайм, модель (запрошено X — рантайм подставил другую), статус, контекст %
  show <агент>         агент и последние события (человекочитаемо)
  plan --from <id> "- [x] шаг" "- [~] шаг" "- [ ] шаг" | plan <агент> [--clear]
  model <агент> <модель>   сменить модель свободного агента (409: рантайм не умеет / агент занят)
  runtime ls           рантаймы: доступность, модель по умолчанию, модели, возможности
  cancel <агент>       прервать ход           kill <агент>   удалить агента
  archive <агент>      убрать в архив         restore <агент>   вернуть (сообщение архивному агенту будит его)

СЕССИИ / РОЛИ / ПРОСТРАНСТВА
  session new "<заголовок>" [--owner X] [--id slug] | session ls [--all] | session show <id>
  session sources <id> | session done <id> [--summary "…"] | session reopen <id> | session rm <id>
  role ls | role show <id> | role add <имя> --instructions "…"|--file F [--description D] [--id ID] [--color 0..360] [--model M] [--runtime nessy-sdk|tclaude]
  role update <id> [--instructions "…"|--file F] [--description D] [--color 0..360] [--icon SF] [--model M] [--runtime R]
                       меняет только переданное; --model "" / --runtime "" убирают значение роли
  role rm <id>
  role import [путь] [--force] [--dry-run]   загрузить роли из markdown (по умолчанию roles/); существующие пропускаются
  space add <путь> [--name N] [--url URL] | space ls | space rm <имя>

ЛЕНТА
  feed [-n 30] [--follow]   общая лента сообщений

ФОНОВОЕ ОБУЧЕНИЕ (оркестратор сам собирает кейсы из сессий; настройки — ~/.nessy-orch/learning.json)
  learn [status]       настройки, очередь заданий, кейсы       learn on | off [--session S]   включить/выключить (в целом или для сессии)
  learn run [--session S]   собрать описание сейчас (сессии или кейса; без --session — все открытые кейсы)
  case ls [--cards]    кейсы        case show <id>   шапка и summary.md        case rm <id>   удалить кейс
  case rebuild <id>    пересобрать описание заново      case note <id> "<текст>"   заметки пользователя кейса
  case read <id>   следующий блок событий кейса (агент-сборщик; следующий — только после принятого draft; протокол в stderr)
  case draft <id> [--file F] [--final] [--from A --key K]   сдать полное описание за блок (иначе stdin), --final — итоговая консолидация
  playbook ls [--cards] | show <id>    плейбуки, которые обучение собрало из кейсов (статусы: draft, review, trial, active, disabled, archived)
  playbook review <id>       запустить авто-ревью            playbook approve <id> | reject <id> [--reason R]   ручное решение
  playbook revert <id> --version N   откат к версии (новой версией)      playbook rm <id>   удалить      playbook note <id> "<текст>"   заметки
  playbook edits <id>        правки улучшателя, ждущие решения (авто-ревью выключено)      playbook accept <id> <hash> | reject <id> <hash>   принять / отклонить правку
  learn journal [--limit N] [--revert <id>]   журнал автоматических решений и откат одной команды

СЛУЖЕБНОЕ
  status               состояние оркестратора
  open [<id сессии>]   открыть сессию в приложении       .  |  app [папка]   открыть приложение с терминалом в папке
  install [--print] [--ensure] | uninstall   служба launchd (вне песочницы)
  hook start | agent | prompt | stop | end   хуки плагина Claude Code (SessionStart, PreToolUse на Agent, UserPromptSubmit, Stop, SessionEnd; вызывает сам плагин)

ОБЩИЕ ФЛАГИ: --json (машинный вывод), --help
Переменные: ORCH_PORT (по умолчанию 4337), NESSY_ORCH_SESSION, NO_COLOR`
