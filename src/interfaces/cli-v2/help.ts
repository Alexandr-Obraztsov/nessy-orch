/** Справка cli-v2: новое поколение CLI оркестратора (дизайн AgentPort §8). */
export const HELP = `nessy-orch-v2 — новое поколение CLI оркестратора (AgentPort §8)

АГЕНТЫ
  spawn [--session S] [--name N] [--title "заголовок"] [--role R] [--runtime nessy-sdk|tclaude] [--model M] [--no-wait] [--timeout СЕК] "задача"
                       создать агента и отправить задачу; --runtime — рантайм (по умолчанию nessy-sdk),
                       --model — модель рантайма. Ждёт ответ (код 3 — не дождались: wait), --no-wait — вернуться сразу.
  send <агент|you> "текст" [--no-wait] [--interrupt] [--timeout СЕК] [--from ID]
                       отправить сообщение и дождаться ответа; --from — от имени агента
  wait <агент> [--timeout СЕК]   дождаться освобождения агента и вывести его последний ответ
  ask <путь|пространство> "задача" [--session S]   короткий spawn в другом каталоге
  ls [--all] [--session S]   дерево агентов: субагенты, рантайм, модель, статус, контекст %
  show <агент>         агент и последние события (человекочитаемо)
  plan --from <id> "- [x] шаг" "- [~] шаг" "- [ ] шаг" | plan <агент> [--clear]
  cancel <агент>       прервать ход

СЕССИИ / РОЛИ / ПРОСТРАНСТВА
  session new "<заголовок>" [--owner X] [--id slug] | session ls [--all] | session show <id>
  session sources <id> | session done <id> [--summary "…"] | session reopen <id> | session rm <id>
  role ls | role show <id> | role add <имя> --instructions "…" | role rm <id>
  space add <путь> [--name N] [--url URL] | space ls | space rm <имя>

ЛЕНТА
  feed [-n 30] [--follow]   общая лента сообщений

СЛУЖЕБНОЕ
  status               состояние оркестратора

ОБЩИЕ ФЛАГИ: --json (машинный вывод), --help
Переменные: ORCH_PORT (по умолчанию 4337), NESSY_ORCH_SESSION, NO_COLOR`
