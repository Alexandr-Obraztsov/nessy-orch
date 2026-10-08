import * as crypto from 'node:crypto';
import * as net from 'node:net';

export const YOU = 'you';

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Короткий читаемый идентификатор. */
export function rid(len = 4): string {
  const b = crypto.randomBytes(len);
  let s = '';
  for (const byte of b) s += ALPHA.charAt(byte % ALPHA.length);
  return s;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Найти свободный loopback-порт начиная с `from`. */
export function freePort(from: number, used: ReadonlySet<number> = new Set()): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number): void => {
      if (p > 65000) {
        reject(new Error('нет свободных портов'));
        return;
      }
      if (used.has(p)) {
        tryPort(p + 1);
        return;
      }
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(p)));
    };
    tryPort(from);
  });
}

/** Безопасное усечение для превью. */
export function clip(s: unknown, n = 200): string {
  const t = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Палитра пространств (hue). */
export const PALETTE: readonly number[] = [210, 28, 150, 285, 340, 175, 55, 250];
