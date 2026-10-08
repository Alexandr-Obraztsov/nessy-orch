/**
 * Store — персистентность оркестратора (JSONL + state.json), без зависимостей.
 *
 *   <home>/state.json            пространства, агенты, курсоры
 *   <home>/messages.jsonl        лента сообщений (группчат)
 *   <home>/agents/<id>.jsonl     поток событий агента (мысли, инструменты, текст)
 *   <home>/logs/space-<n>.log    вывод процессов nessy serve
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentEvent, Message } from '../../shared/types';
import { arr, isObject, parseJson } from './json';

export interface PersistedSpace {
  name: string;
  path: string;
  url: string | null;
  color: number;
}

export interface PersistedAgent {
  id: string;
  name: string;
  space: string;
  parent: string;
  createdAt: string;
  sessionId: string | null;
  displayName: string | null;
  lastEventId: number | null;
  introduced: boolean;
  status: string;
  error: string | null;
  queue: Message[];
  evSeq: number;
  lastActivityAt: string;
  lastReply: string;
}

export interface PersistedState {
  spaces: PersistedSpace[];
  agents: PersistedAgent[];
  msgSeq: number;
  inboxCursor: number;
}

export class Store {
  readonly agentsDir: string;
  readonly logsDir: string;
  private readonly statePath: string;
  private readonly msgPath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private getState: (() => PersistedState) | null = null;

  constructor(readonly home: string) {
    this.agentsDir = path.join(home, 'agents');
    this.logsDir = path.join(home, 'logs');
    fs.mkdirSync(this.agentsDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
    this.statePath = path.join(home, 'state.json');
    this.msgPath = path.join(home, 'messages.jsonl');
  }

  loadState(): PersistedState {
    const raw = parseJson(readText(this.statePath));
    if (!isObject(raw)) return { spaces: [], agents: [], msgSeq: 0, inboxCursor: 0 };
    return {
      spaces: arr(raw['spaces']) as PersistedSpace[],
      agents: arr(raw['agents']) as PersistedAgent[],
      msgSeq: typeof raw['msgSeq'] === 'number' ? raw['msgSeq'] : 0,
      inboxCursor: typeof raw['inboxCursor'] === 'number' ? raw['inboxCursor'] : 0,
    };
  }

  /** Отложенная атомарная запись. */
  saveStateSoon(getState: () => PersistedState): void {
    this.getState = getState;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 200);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.getState) return;
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.getState(), null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  appendMessage(m: Message): void {
    fs.appendFileSync(this.msgPath, JSON.stringify(m) + '\n');
  }

  loadMessages(limit = 5000): Message[] {
    return readJsonl<Message>(this.msgPath, limit);
  }

  appendEvent(agentId: string, ev: AgentEvent): void {
    fs.appendFileSync(path.join(this.agentsDir, agentId + '.jsonl'), JSON.stringify(ev) + '\n');
  }

  readEvents(agentId: string, limit = 500): AgentEvent[] {
    return readJsonl<AgentEvent>(path.join(this.agentsDir, agentId + '.jsonl'), limit);
  }

  /** Историю не удаляем: архивируем файл. */
  archiveAgent(agentId: string): void {
    const p = path.join(this.agentsDir, agentId + '.jsonl');
    if (fs.existsSync(p)) fs.renameSync(p, p + '.removed');
  }

  logPath(spaceName: string): string {
    return path.join(this.logsDir, `space-${spaceName.replace(/[^\w.-]/g, '_')}.log`);
  }
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJsonl<T>(file: string, limit: number): T[] {
  const lines = readText(file).split('\n').filter(Boolean);
  const out: T[] = [];
  for (const l of lines.slice(-limit)) {
    const v = parseJson(l);
    if (isObject(v)) out.push(v as T); // битые строки (обрыв записи) пропускаем
  }
  return out;
}
