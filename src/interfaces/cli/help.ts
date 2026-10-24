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

СЛУЖЕБНОЕ
  status               состояние оркестратора
  open [<id сессии>]   открыть сессию в приложении       .  |  app [папка]   открыть приложение с терминалом в папке
  install [--print] [--ensure] | uninstall   служба launchd (вне песочницы)
  hook start           хук SessionStart плагина Claude Code (вызывает сам плагин)

ОБЩИЕ ФЛАГИ: --json (машинный вывод), --help
Переменные: ORCH_PORT (по умолчанию 4337), NESSY_ORCH_SESSION, NO_COLOR`
