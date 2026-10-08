import * as os from 'node:os';
import * as path from 'node:path';

export interface Config {
  root: string;
  host: string;
  port: number;
  /** каталог состояния (вне песочницы: оркестратор запускается пользователем) */
  home: string;
  nessyBin: string;
  nessyServeArgs: string[];
  serveBasePort: number;
  maxSessionsPerSpace: number;
  /** автоподтверждение прав агентов (решение пользователя) */
  autoApprove: boolean;
  /** защита от зацикливания межагентной переписки */
  maxHops: number;
  rateLimitPerMinute: number;
  healthTimeoutMs: number;
  uiDir: string;
  cliPath: string;
}

const int = (v: string | undefined, d: number): number => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

const flag = (v: string | undefined, d: boolean): boolean =>
  v === undefined || v === '' ? d : !/^(0|false|no|off)$/i.test(v);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // dist/src/core/config.js → корень проекта на три уровня выше dist/
  const root = path.resolve(__dirname, '..', '..', '..');
  return {
    root,
    host: '127.0.0.1',
    port: int(env['ORCH_PORT'], 4337),
    home: env['NESSY_ORCH_HOME'] ?? path.join(os.homedir(), '.nessy-orch'),
    nessyBin: env['NESSY_BIN'] ?? path.join(os.homedir(), '.local', 'bin', 'nessy'),
    nessyServeArgs: (env['NESSY_SERVE_ARGS'] ?? '').split(/\s+/).filter(Boolean),
    serveBasePort: int(env['SERVE_BASE_PORT'], 4360),
    maxSessionsPerSpace: int(env['MAX_SESSIONS'], 20),
    autoApprove: flag(env['ORCH_AUTO_APPROVE'], true),
    maxHops: int(env['ORCH_MAX_HOPS'], 8),
    rateLimitPerMinute: int(env['ORCH_RATE_LIMIT'], 30),
    healthTimeoutMs: int(env['ORCH_HEALTH_TIMEOUT_MS'], 60000),
    uiDir: env['ORCH_UI_DIR'] ?? path.join(root, 'ui', 'dist'),
    cliPath: path.join(root, 'bin', 'nessy-orch'),
  };
}
