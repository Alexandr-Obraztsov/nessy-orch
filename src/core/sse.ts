/** Минимальный SSE-парсер (общий для оркестратора и CLI). */

export interface SseFrame {
  id: string | null;
  event: string;
  data: string;
}

export function parseFrame(raw: string): SseFrame | null {
  let id: string | null = null;
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const c = line.indexOf(':');
    const field = c === -1 ? line : line.slice(0, c);
    let val = c === -1 ? '' : line.slice(c + 1);
    if (val.startsWith(' ')) val = val.slice(1);
    if (field === 'id') id = val;
    else if (field === 'event') event = val;
    else if (field === 'data') data.push(val);
  }
  if (!data.length && id === null && event === 'message') return null;
  return { id, event, data: data.join('\n') };
}

export class SseParser {
  private buf = '';
  constructor(private readonly onFrame: (f: SseFrame) => void) {}

  push(chunk: string): void {
    this.buf = (this.buf + chunk).replace(/\r\n/g, '\n');
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) !== -1) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const f = parseFrame(raw);
      if (f) this.onFrame(f);
    }
  }
}

/** Сформировать SSE-кадр для отправки клиенту. */
export function formatFrame(data: unknown, opts: { event?: string; id?: number | string } = {}): string {
  let s = '';
  if (opts.id !== undefined) s += `id: ${opts.id}\n`;
  if (opts.event) s += `event: ${opts.event}\n`;
  s += `data: ${JSON.stringify(data)}\n\n`;
  return s;
}
