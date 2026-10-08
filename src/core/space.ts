/**
 * Space — воркспейс: путь + (опционально) управляемый процесс `nessy serve`.
 *   managed  — оркестратор сам запускает `nessy serve` на свободном порту;
 *   external — `url` указывает на уже запущенный демон.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import type { SpaceStatus, SpaceView } from '../../shared/types';
import type { Config } from './config';
import type { Hub } from './hub';
import { errMsg } from './json';
import { NessyClient } from './nessy-client';
import type { Store } from './store';
import { PALETTE, freePort, sleep } from './util';

export interface SpaceInit {
  name: string;
  path: string;
  url?: string | null;
  color?: number;
}

export interface SpaceDeps {
  config: Config;
  hub: Hub;
  store: Store;
  usedPorts: Set<number>;
  onExit: (space: Space, info: { intended: boolean; code: number | null; signal: NodeJS.Signals | null }) => void;
}

export class Space {
  readonly name: string;
  readonly path: string;
  readonly url: string | null;
  readonly color: number;
  status: SpaceStatus = 'stopped';
  error: string | null = null;
  client: NessyClient | null = null;

  private port: number | null = null;
  private proc: ChildProcess | null = null;
  private tail: string[] = [];
  private starting: Promise<void> | null = null;
  private stopping = false;

  constructor(init: SpaceInit, private readonly deps: SpaceDeps) {
    this.name = init.name;
    this.path = init.path;
    this.url = init.url ?? null;
    this.color = init.color ?? PALETTE[0] ?? 210;
  }

  get managed(): boolean {
    return !this.url;
  }

  toJSON(): SpaceView {
    return {
      name: this.name,
      path: this.path,
      color: this.color,
      mode: this.managed ? 'managed' : 'external',
      url: this.url ?? (this.port ? `http://127.0.0.1:${this.port}` : null),
      status: this.status,
      error: this.error,
    };
  }

  private setStatus(status: SpaceStatus, error: string | null = null): void {
    this.status = status;
    this.error = error;
    this.deps.hub.publish({ t: 'space', space: this.toJSON() });
  }

  /** Гарантировать, что nessy serve поднят. */
  async ensureReady(): Promise<NessyClient> {
    if (this.status === 'ready' && this.client) return this.client;
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    await this.starting;
    if (!this.client) throw new Error(`пространство «${this.name}» недоступно`);
    return this.client;
  }

  private async start(): Promise<void> {
    this.stopping = false;
    this.setStatus('starting');
    const { config } = this.deps;
    try {
      if (this.url) {
        this.client = new NessyClient(this.url);
      } else {
        const port = await freePort(config.serveBasePort, this.deps.usedPorts);
        this.deps.usedPorts.add(port);
        this.port = port;
        this.client = new NessyClient(`http://127.0.0.1:${port}`);
        this.spawnServe(port);
      }
      const t0 = Date.now();
      while (Date.now() - t0 < config.healthTimeoutMs) {
        if (await this.client.health()) {
          this.setStatus('ready');
          return;
        }
        if (this.managed && !this.proc) throw new Error('nessy serve завершился при запуске: ' + this.tail.slice(-3).join(' | '));
        await sleep(300);
      }
      throw new Error('nessy serve не ответил на /health за отведённое время');
    } catch (e) {
      this.setStatus('failed', errMsg(e));
      this.client = null;
      this.kill();
      throw e;
    }
  }

  private spawnServe(port: number): void {
    const { config, store } = this.deps;
    const args = [
      'serve',
      '--port', String(port),
      '--hostname', '127.0.0.1',
      '--no-web',
      '--workspace', this.path,
      '--max-sessions', String(config.maxSessionsPerSpace),
      ...config.nessyServeArgs,
    ];
    const log = fs.createWriteStream(store.logPath(this.name), { flags: 'a' });
    log.write(`\n--- ${new Date().toISOString()} spawn ${config.nessyBin} ${args.join(' ')}\n`);
    const proc = spawn(config.nessyBin, args, { cwd: this.path, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (d: Buffer | string): void => {
      log.write(d);
      for (const l of String(d).split('\n')) if (l.trim()) this.tail.push(l.trim());
      if (this.tail.length > 30) this.tail.splice(0, this.tail.length - 30);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => onData(`spawn error: ${e.message}`));
    proc.on('exit', (code, signal) => {
      log.write(`--- exit code=${code} signal=${signal}\n`);
      log.end();
      this.proc = null;
      this.deps.usedPorts.delete(port);
      const wasReady = this.status === 'ready';
      const intended = this.stopping;
      this.client = null;
      if (intended) this.setStatus('stopped');
      else if (wasReady) this.setStatus('failed', `nessy serve завершился (code=${code}, signal=${signal})`);
      this.deps.onExit(this, { intended, code, signal });
    });
    this.proc = proc;
  }

  private kill(): void {
    const p = this.proc;
    if (!p) return;
    this.stopping = true;
    p.kill('SIGTERM');
    setTimeout(() => p.kill('SIGKILL'), 5000).unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const p = this.proc;
    if (p) {
      const done = new Promise<void>((r) => p.once('exit', () => r()));
      this.kill();
      await Promise.race([done, sleep(6000)]);
    }
    this.client = null;
    this.setStatus('stopped');
  }
}
