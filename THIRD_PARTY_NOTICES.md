# Third-party notices

Готовые роли в `roles/` адаптированы (переписаны на русском, с учётом инструментов nessy) из следующих проектов
под лицензией MIT. Роли `gitlab-mr-reviewer`, `jira-analyst`, `wiki-researcher`, `performance` написаны заново;
upstream указан там, откуда взяты структура и идеи (см. комментарий в конце каждого файла).

## oh-my-claudecode

- Репозиторий: https://github.com/Yeachan-Heo/oh-my-claudecode
- Copyright (c) 2025 Yeachan Heo
- Производные файлы: `roles/analyst.md`, `roles/architect.md`, `roles/code-reviewer.md`, `roles/gitlab-mr-reviewer.md`,
  `roles/debugger.md`, `roles/executor.md`, `roles/test-engineer.md`, `roles/verifier.md`, `roles/security-reviewer.md`,
  `roles/jira-analyst.md`, `roles/wiki-researcher.md`, `roles/writer.md`, `roles/simplifier.md`
  (источники: `agents/{analyst,planner,architect,code-reviewer,debugger,tracer,executor,test-engineer,verifier,security-reviewer,document-specialist,writer,code-simplifier}.md`)

## wshobson/agents

- Репозиторий: https://github.com/wshobson/agents
- Copyright (c) 2024 Seth Hobson
- Производные файлы: `roles/architect.md` (`plugins/comprehensive-review/agents/architect-review.md`),
  `roles/code-reviewer.md` (`plugins/agent-teams/agents/team-reviewer.md`),
  `roles/debugger.md` (`plugins/agent-teams/agents/team-debugger.md`)

## obra/superpowers

- Репозиторий: https://github.com/obra/superpowers
- Copyright (c) 2025 Jesse Vincent
- Производные файлы: `roles/executor.md` (`skills/subagent-driven-development/implementer-prompt.md`),
  `roles/verifier.md` (`skills/verification-before-completion/SKILL.md`, `skills/subagent-driven-development/task-reviewer-prompt.md`)

## VoltAgent/awesome-claude-code-subagents

- Репозиторий: https://github.com/VoltAgent/awesome-claude-code-subagents
- Copyright (c) 2025 VoltAgent
- Производные файлы: `roles/wiki-researcher.md` (`categories/10-research-analysis/research-analyst.md`,
  `categories/09-meta-orchestration/knowledge-synthesizer.md`), `roles/simplifier.md`
  (`categories/06-developer-experience/refactoring-specialist.md`); `roles/performance.md`
  (`categories/04-quality-security/performance-engineer.md`) использовал только как чек-лист тем, текст написан заново.

## Текст лицензии MIT

Одинаковый для всех перечисленных проектов; строки Copyright приведены выше для каждого проекта.

```
MIT License

Copyright (c) 2025 Yeachan Heo
Copyright (c) 2024 Seth Hobson
Copyright (c) 2025 Jesse Vincent
Copyright (c) 2025 VoltAgent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
