export const HELP = `nessy-orch — оркестратор агентов nessy

АГЕНТЫ
  spawn [--space S] [--name N] [--wait] [--timeout СЕК] ["задача"]
                       создать агента (и сразу отправить задачу). --wait — дождаться ответа
  send <агент|you> "текст" [--wait] [--timeout СЕК] [--from ID]
                       отправить сообщение; --from — от имени агента (для самих агентов)
  ask <путь|space> "задача"   короткий путь: spawn --wait (совместим со старым nessy-ask)
  ls                   список агентов            show <агент>   последние события агента
  watch <агент>        живой чат с агентом       cancel <агент>  прервать ход
  kill <агент>         удалить агента

ЛЕНТА И ВХОДЯЩИЕ
  feed [-n 30] [--follow]   общая лента сообщений
  inbox [--wait СЕК] [--peek]   новые ответы агентов вам (курсор сохраняется)

ПРОСТРАНСТВА
  space add <путь> [--name N] [--url URL]    space ls    space rm <имя> [--force]

СЛУЖЕБНОЕ
  status               состояние оркестратора   open   открыть UI
  install [--print]    установить launchd-сервис  uninstall

ОБЩИЕ ФЛАГИ: --json (машинный вывод), --help
Переменные: ORCH_PORT (по умолчанию 4337), NO_COLOR`
