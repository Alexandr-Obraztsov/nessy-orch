/**
 * NessyClient — ЕДИНСТВЕННОЕ место, которое знает протокол `nessy serve`.
 * Если контракт nessy изменится, правится только этот файл (и docs/nessy-contract.md).
 *
 * Статус контракта:
 *   ПРОВЕРЕНО живьём:  GET /health, POST /session {cwd, sessionScope:"thread"} → независимые сессии,
 *                      POST /session/:id/prompt → {promptId}, GET /session/:id/events (SSE),
 *                      события session_update / turn_complete / session_metadata_updated
 *   ИЗ КОДА nessy:     POST /session/:id/permission/:requestId {outcome:{outcome:"selected",optionId}|{outcome:"cancelled"}},
 *                      POST /session/:id/cancel, DELETE /session/:id, POST /session/:id/load,
 *                      событие permission_request {requestId, options[], toolCall}, session_died, client_evicted
 *   НЕ ПРОВЕРЕНО:      тела ответов cancel/load/DELETE, kind вариантов в permission_request
 *   ТРЕБУЕТ ТОКЕНА:    POST /session/:id/approval-mode (token_required) — поэтому права подтверждаем голосованием
 */
import * as http from 'node:http';
import { URL } from 'node:url';
import { SseParser } from './sse';
import { HttpError, clip } from './util';
import { arr, isObject, obj, parseJson, str, strOrNull, type JsonObject } from './json';

export interface NessyResponse {
  status: number;
  json: JsonObject;
}

export interface PermissionOption {
  optionId: string;
  kind: string;
  name: string;
}

/** Нормализованные события nessy (стабильная внутренняя форма). */
export type NessyEvent =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; toolId: string; name: string; title: string; input: Record<string, unknown>; status: string }
  | { kind: 'tool_update'; toolId: string; name: string; status: string; output: string }
  | { kind: 'turn_complete'; stopReason: string; promptId: string | null }
  | { kind: 'meta'; displayName: string }
  | { kind: 'permission'; requestId: string; options: PermissionOption[]; title: string }
  | { kind: 'died'; reason: string }
  | { kind: 'evicted' };

export interface Subscription {
  close(): void;
}

export interface SubscribeOptions {
  lastEventId: number | null;
  onEvent: (ev: NessyEvent, eventId: number | null) => void;
  onState?: (s: 'open' | 'reconnecting') => void;
}

export class NessyClient {
  private readonly host: string;
  private readonly port: number;

  constructor(readonly baseUrl: string) {
    const u = new URL(baseUrl);
    this.host = u.hostname;
    this.port = parseInt(u.port, 10) || 80;
  }

  // ---------- низкий уровень ----------
  request(method: string, path: string, body?: unknown, timeoutMs = 30000): Promise<NessyResponse> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          method,
          path,
          headers: {
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let d = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (d += c));
          res.on('end', () => {
            const parsed = parseJson(d);
            resolve({ status: res.statusCode ?? 0, json: isObject(parsed) ? parsed : { raw: d } });
          });
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`таймаут ${method} ${path}`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async ok(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<JsonObject> {
    const r = await this.request(method, path, body, timeoutMs);
    if (r.status >= 400) {
      const detail = str(r.json['error']) || str(r.json['raw']) || JSON.stringify(r.json);
      throw new HttpError(502, 'nessy_error', `nessy ${method} ${path} → ${r.status}: ${clip(detail, 300)}`);
    }
    return r.json;
  }

  // ---------- высокий уровень ----------
  async health(): Promise<boolean> {
    try {
      const r = await this.request('GET', '/health', undefined, 3000);
      return r.status === 200;
    } catch {
      return false;
    }
  }

  /** Создать независимую сессию (один субагент = одна сессия). */
  async createSession(cwd: string): Promise<{ sessionId: string }> {
    const j = await this.ok('POST', '/session', { cwd, sessionScope: 'thread' }, 60000);
    const sessionId = strOrNull(j['sessionId']);
    if (!sessionId) throw new HttpError(502, 'nessy_error', 'nessy не вернул sessionId: ' + clip(JSON.stringify(j)));
    return { sessionId };
  }

  /** Поднять сессию после рестарта. true — если получилось. */
  async resumeSession(sessionId: string, cwd: string): Promise<boolean> {
    try {
      const r = await this.request('POST', `/session/${sessionId}/load`, { cwd });
      return r.status < 300;
    } catch {
      return false;
    }
  }

  /** Отправить промпт (асинхронно: результат придёт событиями). */
  async prompt(sessionId: string, text: string): Promise<{ promptId: string | null }> {
    const j = await this.ok('POST', `/session/${sessionId}/prompt`, { prompt: [{ type: 'text', text }] });
    return { promptId: strOrNull(j['promptId']) };
  }

  async cancel(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/cancel`, {}).catch(() => undefined);
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/session/${sessionId}`).catch(() => undefined);
  }

  /** Проголосовать по запросу разрешения (optionId=null → отмена). */
  async vote(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
    const body = optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } };
    await this.request('POST', `/session/${sessionId}/permission/${requestId}`, body);
  }

  /** Подписка на SSE-поток сессии с автопереподключением и Last-Event-ID. */
  subscribe(sessionId: string, opts: SubscribeOptions): Subscription {
    let closed = false;
    let req: http.ClientRequest | null = null;
    let lastId = opts.lastEventId;
    let retry: NodeJS.Timeout | null = null;

    const again = (): void => {
      if (closed || retry) return;
      opts.onState?.('reconnecting');
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, 1000);
    };

    const connect = (): void => {
      if (closed) return;
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (lastId !== null) headers['Last-Event-ID'] = String(lastId);
      req = http.request({ host: this.host, port: this.port, method: 'GET', path: `/session/${sessionId}/events`, headers }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          if (res.statusCode === 404) {
            closed = true;
            opts.onEvent({ kind: 'died', reason: 'сессия не найдена в nessy' }, lastId);
            return;
          }
          again();
          return;
        }
        opts.onState?.('open');
        res.setEncoding('utf8');
        const parser = new SseParser((f) => {
          if (f.id !== null && /^\d+$/.test(f.id)) lastId = parseInt(f.id, 10);
          const ev = normalize(f.event, parseJson(f.data));
          if (ev) opts.onEvent(ev, lastId);
        });
        res.on('data', (c: string) => parser.push(c));
        res.on('end', again);
        res.on('error', again);
      });
      req.on('error', again);
      req.end();
    };

    connect();
    return {
      close(): void {
        closed = true;
        if (retry) clearTimeout(retry);
        req?.destroy();
      },
    };
  }
}

/**
 * Привести событие nessy к внутренней форме. null — событие оркестратору не нужно.
 * Вход — произвольный JSON, поэтому всё читается через безопасные хелперы.
 */
export function normalize(eventName: string, frame: unknown): NessyEvent | null {
  if (!isObject(frame)) return null;
  const type = str(frame['type'], eventName);
  const d = obj(frame['data']);

  if (type === 'session_update') {
    const u = obj(d['update']);
    const su = str(u['sessionUpdate']);
    const text = str(obj(u['content'])['text']);
    const meta = obj(u['_meta']);
    if (su === 'agent_message_chunk') return text ? { kind: 'text', text } : null;
    if (su === 'agent_thought_chunk') return text ? { kind: 'thought', text } : null;
    if (su === 'tool_call') {
      return {
        kind: 'tool',
        toolId: str(u['toolCallId']),
        name: str(meta['toolName']) || str(u['kind'], 'tool'),
        title: str(u['title']),
        input: obj(u['rawInput']),
        status: str(u['status'], 'in_progress'),
      };
    }
    if (su === 'tool_call_update') {
      let output = '';
      if (typeof u['rawOutput'] === 'string') output = u['rawOutput'];
      else if (u['rawOutput'] !== undefined) output = JSON.stringify(u['rawOutput']);
      else output = arr(u['content']).map((x) => str(obj(obj(x)['content'])['text'])).join('\n');
      return { kind: 'tool_update', toolId: str(u['toolCallId']), name: str(meta['toolName']), status: str(u['status'], 'completed'), output };
    }
    return null;
  }
  if (type === 'turn_complete') return { kind: 'turn_complete', stopReason: str(d['stopReason'], 'end_turn'), promptId: strOrNull(d['promptId']) };
  if (type === 'session_metadata_updated') {
    const displayName = str(d['displayName']);
    return displayName ? { kind: 'meta', displayName } : null;
  }
  if (type === 'permission_request') {
    const tc = obj(d['toolCall']);
    const options = arr(d['options']).map((o): PermissionOption => {
      const oo = obj(o);
      return { optionId: str(oo['optionId']), kind: str(oo['kind']), name: str(oo['name']) };
    });
    return { kind: 'permission', requestId: str(d['requestId']), options, title: str(tc['title']) || str(obj(tc['_meta'])['toolName']) || 'действие' };
  }
  if (type === 'session_died') return { kind: 'died', reason: 'процесс агента nessy завершился' };
  if (type === 'client_evicted') return { kind: 'evicted' };
  return null;
}

/** Выбрать вариант ответа на запрос разрешения. approve=false → отклонить. */
export function pickPermissionOption(options: readonly PermissionOption[], approve: boolean): string | null {
  const opts = options.filter((o) => o.optionId);
  const match = (re: RegExp): PermissionOption | undefined => opts.find((o) => re.test(o.kind) || re.test(o.optionId));
  if (approve) {
    const hit = match(/^allow_once$/) ?? match(/^allow_always$/) ?? match(/allow|proceed|approve|yes/i) ?? opts.find((o) => !/cancel|reject|deny|no/i.test(o.optionId)) ?? opts[0];
    return hit?.optionId ?? null;
  }
  return (match(/^reject_once$/) ?? match(/reject|deny|no/i))?.optionId ?? null;
}
