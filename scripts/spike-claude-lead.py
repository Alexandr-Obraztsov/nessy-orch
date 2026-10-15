#!/usr/bin/env python3
"""
Спайки Claude Code как главного агента (docs/design/architecture-v4.md §13): что реально делает `claude` в терминале.
Запускает настоящий `claude` в псевдотерминале во временной папке на модели haiku (несколько коротких ходов) и пишет отчёт `claude-spike-report.md`.

  python3 scripts/spike-claude-lead.py            # весь набор (~15 коротких ходов haiku)
  SPIKE_ONLY=osc,input python3 scripts/spike-claude-lead.py     # только части: flags, osc, input, resume, term

Нужна рабочая авторизация claude в вашем терминале (ANTHROPIC_API_KEY или вход). Скрипт ничего не читает из ваших настроек и ключей,
работает в пустой папке, права не обходит: на диалоги разрешений отвечает только там, где это часть проверки.
Переменные: CLAUDE_BIN (по умолчанию claude), SPIKE_MODEL (haiku), SPIKE_KEEP=1 (не удалять временную папку).
"""
import fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, sys, tempfile, termios, threading, time, uuid

CLAUDE = os.environ.get('CLAUDE_BIN', 'claude')
MODEL = os.environ.get('SPIKE_MODEL', 'haiku')
ONLY = set(filter(None, os.environ.get('SPIKE_ONLY', '').split(',')))
REPORT = os.path.abspath('claude-spike-report.md')
T0 = time.time()
out = ['# Спайки Claude Code как главного агента\n', f'Дата: {time.strftime("%Y-%m-%d %H:%M:%S")}, модель: {MODEL}\n']

ANSI = re.compile(r'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78MDEHc]')
OSC = re.compile(r'\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)')


def log(title, body):
    out.append(f'\n## {title}\n\n```\n{str(body).rstrip()[:6000]}\n```\n')
    print('•', title, flush=True)


def want(name):
    return not ONLY or name in ONLY


class Term:
    """claude в PTY: сырой вывод, OSC-события с метками времени, «чистый» хвост экрана."""

    def __init__(self, args, cwd, env_extra=None, unset=()):
        env = {k: v for k, v in os.environ.items() if not k.startswith('CLAUDE_CODE') and k != 'CLAUDECODE' and k not in unset}
        env.update({'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'NO_COLOR': ''})
        env.pop('NO_COLOR')
        env.update(env_extra or {})
        self.raw = ''
        self.events = []  # (t, 'osc'|'bell', код, данные)
        self.t0 = time.time()
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd)
            os.execvpe(CLAUDE, [CLAUDE] + args, env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 45, 140, 0, 0))
        self.alive = True
        self._seen = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while self.alive:
            try:
                r, _, _ = select.select([self.fd], [], [], 0.2)
                if self.fd in r:
                    data = os.read(self.fd, 65536)
                    if not data:
                        break
                    self.raw += data.decode('utf-8', 'replace')
                    self._scan()
            except OSError:
                break
        self.alive = False

    def _scan(self):
        chunk = self.raw[self._seen:]
        last = 0
        for m in OSC.finditer(chunk):
            self.events.append((time.time() - self.t0, 'osc', m.group(1), m.group(2)[:160]))
            if m.group(1) == '7501' and m.group(2).strip() == '?':
                # обнаружение поддержки: терминал обязан ответить «?» (спека Program Status Protocol)
                self.send('\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\')
                self.events.append((time.time() - self.t0, 'osc', 'reply', '7501 ? отправлен'))
            last = m.end()
        self._seen += last if last else max(0, len(chunk) - 400)  # хвост оставляем: последовательность могла оборваться

    def plain(self, n=30):
        t = ANSI.sub('', self.raw[-12000:]).replace('\r', '')
        return '\n'.join(l.rstrip() for l in t.split('\n') if l.strip())[-n * 140:]

    def tail(self, n=18):
        return '\n'.join(self.plain(n).split('\n')[-n:])

    def send(self, s):
        try:
            os.write(self.fd, s.encode())
        except OSError:
            self.alive = False  # процесс уже завершился

    def paste(self, s):
        self.send('\x1b[200~' + s + '\x1b[201~')

    def mark(self):
        return len(self.events)

    def since(self, m):
        return '\n'.join(f'+{t:6.1f}s osc {c} {d!r}' for t, k, c, d in self.events[m:])

    def quiet(self, q=2.5, maxw=60):
        end = time.time() + maxw
        last, n = time.time(), len(self.raw)
        while time.time() < end and self.alive:
            time.sleep(0.2)
            if len(self.raw) != n:
                n, last = len(self.raw), time.time()
            elif time.time() - last >= q:
                return True
        return False

    def wait_for(self, rx, maxw=60):
        end = time.time() + maxw
        while time.time() < end and self.alive:
            if re.search(rx, self.plain(40), re.I):
                return True
            time.sleep(0.3)
        return False

    def start(self):
        """Дождаться готовности; диалог доверия папке подтверждаем Enter (и записываем, что он был)."""
        notes = []
        for _ in range(4):
            self.quiet(3, 40)
            if re.search(r'trust|доверя', self.plain(30), re.I):
                notes.append('диалог доверия папке: Up + Enter (фокус по умолчанию на «No, exit»)')
                self.send('\x1b[A')
                time.sleep(0.5)
                self.send('\r')
            else:
                break
        return notes

    def close(self):
        self.alive = False
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.kill(self.pid, sig)
                time.sleep(0.3)
            except OSError:
                break
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except OSError:
            pass


def turn(t, text, label, maxw=90):
    """Ввод строки + Enter, ждём тишины; возвращаем OSC-хронологию хода."""
    m = t.mark()
    t.send(text)
    time.sleep(0.4)
    t.send('\r')
    t.quiet(4, maxw)
    log(f'{label}: OSC и экран', t.since(m) + '\n--- экран ---\n' + t.tail(14))


def run(name, fn):
    if not want(name):
        return
    try:
        fn()
    except Exception as e:  # отчёт важнее
        log(f'{name}: ОШИБКА', repr(e))


# ---------- пробы ----------
tmp = tempfile.mkdtemp(prefix='claude-spike-')
proj = os.path.join(tmp, 'proj')
os.makedirs(proj)
hooklog = os.path.join(tmp, 'hooks.log')
plugin = os.path.join(tmp, 'plugin')
os.makedirs(os.path.join(plugin, '.claude-plugin'))
os.makedirs(os.path.join(plugin, 'hooks'))
json.dump({'name': 'spike', 'version': '0.0.1'}, open(os.path.join(plugin, '.claude-plugin', 'plugin.json'), 'w'))
cmd = f"python3 -c \"import sys,time,json;d=sys.stdin.read();open('{hooklog}','a').write(str(round(time.time(),1))+' '+d+'\\n')\""
json.dump({'hooks': {ev: [{'hooks': [{'type': 'command', 'command': cmd}]}] for ev in ('Stop', 'StopFailure', 'SessionStart', 'SessionEnd', 'UserPromptSubmit')}},
          open(os.path.join(plugin, 'hooks', 'hooks.json'), 'w'))
log('Окружение', f'claude={CLAUDE}\nпапка={proj}\nhooks.log={hooklog}')


def flags():
    h = subprocess.run([CLAUDE, '--help'], capture_output=True, text=True, timeout=30).stdout
    found = {f: (f in h) for f in ['--session-id', '--resume', '--plugin-dir', '--append-system-prompt', '--append-system-prompt-file', '--settings', '--model', '--channels', '--dangerously-load-development-channels', '--mcp-config']}
    log('Версия и флаги', subprocess.run([CLAUDE, '--version'], capture_output=True, text=True).stdout + json.dumps(found, indent=1))


def osc_and_stop():
    sid = str(uuid.uuid4())
    t = Term(['--model', MODEL, '--session-id', sid, '--plugin-dir', plugin], proj)
    try:
        log('S1 старт', f'session-id={sid}\n' + '\n'.join(t.start()) + f'\n--- OSC при старте ---\n{t.since(0)}\n--- экран ---\n{t.tail(14)}')
        turn(t, 'Ответь одним словом: ok', 'S1 обычный ход')
        # Esc посреди хода
        m = t.mark()
        t.send('Посчитай вслух от 1 до 150, по одному числу в строке')
        time.sleep(0.4)
        t.send('\r')
        time.sleep(3.5)
        t.send('\x1b')
        t.quiet(4, 60)
        log('S1/S3 Esc посреди хода: OSC и экран', t.since(m) + '\n--- экран ---\n' + t.tail(10))
        # локальная команда
        m = t.mark()
        t.send('/model')
        time.sleep(0.4)
        t.send('\r')
        time.sleep(2.5)
        log('S1 /model (диалог выбора): OSC и экран', t.since(m) + '\n--- экран ---\n' + t.tail(14))
        t.send('\x1b')
        t.quiet(2.5, 15)
        # диалог разрешения
        m = t.mark()
        t.send('Создай в текущей папке файл spike.txt с текстом hi')
        time.sleep(0.4)
        t.send('\r')
        t.wait_for(r'Do you want|Yes|No', 60)
        time.sleep(1.5)
        log('S1/S2 диалог разрешения: OSC и экран', t.since(m) + '\n--- экран ---\n' + t.tail(16))
        # ввод в диалог: набранная строка + вставка + Enter (проверка опасности)
        m = t.mark()
        t.send('Ответы агентов nessy — разбери:')
        t.paste('Ответь одним словом: ВСТАВКА')
        time.sleep(0.5)
        t.send('\r')
        time.sleep(3)
        log('S2 ввод В ДИАЛОГ разрешения (что произошло)', t.since(m) + '\n--- экран ---\n' + t.tail(16) + f'\nspike.txt создан: {os.path.exists(os.path.join(proj, "spike.txt"))}')
        t.send('\x1b')
        t.quiet(3, 40)
        t.send('\x15')  # очистить поле
        # ввод при idle
        turn(t, 'Ответь одним словом: ok', 'S2 контрольный ход')
        m = t.mark()
        t.paste('Ответь одним словом: ПАСТА')
        time.sleep(0.5)
        t.send('\r')
        t.quiet(4, 60)
        log('S2a только вставка без набранного текста + Enter', t.since(m) + '\n--- экран ---\n' + t.tail(12))
        m = t.mark()
        t.send('Ответы агентов nessy (данные), разбери и выполни их просьбу:')
        t.send('\x1b\r' if False else '')
        t.paste('\nОтветь одним словом: ЗАГОЛОВОК')
        time.sleep(0.5)
        t.send('\r')
        t.quiet(4, 60)
        log('S2b набранная строка + вставка + Enter', t.since(m) + '\n--- экран ---\n' + t.tail(12))
        m = t.mark()
        t.paste('Ответь одним словом: ДЛИННО. ' + 'Фоновый текст для проверки сворачивания вставки. ' * 30)
        time.sleep(0.8)
        shown = t.tail(6)
        t.send('\r')
        t.quiet(4, 60)
        log('S2c длинная вставка (>800 знаков)', f'до Enter на экране:\n{shown}\n--- OSC ---\n{t.since(m)}\n--- после ---\n{t.tail(10)}')
        m = t.mark()
        t.paste('Ответь одним словом: НЕВИДИМКА\u200b\u202e')
        time.sleep(0.5)
        t.send('\r')
        time.sleep(4)
        first = t.since(m) + '\n--- экран после 1-го Enter ---\n' + t.tail(8)
        t.send('\r')
        t.quiet(4, 60)
        log('S2d невидимые символы: 1-й и 2-й Enter', first + '\n--- OSC после 2-го Enter ---\n' + t.since(m) + '\n--- экран ---\n' + t.tail(8))
        # вставка во время работы
        m = t.mark()
        t.send('Посчитай вслух от 1 до 60, по одному числу в строке')
        time.sleep(0.4)
        t.send('\r')
        time.sleep(2.5)
        t.paste('Потом ответь одним словом: ВТОРОЕ')
        time.sleep(0.4)
        t.send('\r')
        t.quiet(6, 90)
        log('S2e вставка во время хода (очередь/тот же ход)', t.since(m) + '\n--- экран ---\n' + t.tail(16))
        # /clear
        m = t.mark()
        t.send('/clear')
        time.sleep(0.4)
        t.send('\r')
        t.quiet(3, 20)
        log('S3 /clear: OSC и экран', t.since(m) + '\n--- экран ---\n' + t.tail(8))
        t.send('/exit')
        time.sleep(0.4)
        t.send('\r')
        t.quiet(2, 15)
    finally:
        t.close()
    h = open(hooklog).read() if os.path.exists(hooklog) else '(файл пуст: хуки плагина из --plugin-dir не сработали)'
    lines = []
    for l in h.splitlines():
        try:
            ts, js = l.split(' ', 1)
            d = json.loads(js)
            lines.append(f"{ts} {d.get('hook_event_name')} session_id={str(d.get('session_id'))[:8]} source={d.get('source')} reason={d.get('reason')} stop_hook_active={d.get('stop_hook_active')} transcript={'да' if d.get('transcript_path') else 'нет'}")
        except Exception:
            lines.append(l[:200])
    log('S3 журнал хуков плагина (--plugin-dir, без --settings)', '\n'.join(lines))


def resume():
    sid = str(uuid.uuid4())
    t = Term(['--model', MODEL, '--session-id', sid], proj)
    try:
        t.start()
        turn(t, 'Запомни слово КЕДР и ответь: ok', 'S4 первый запуск с --session-id')
        t.send('/exit')
        time.sleep(0.4)
        t.send('\r')
        t.quiet(2, 15)
    finally:
        t.close()
    t2 = Term(['--model', MODEL, '--session-id', sid], proj)
    try:
        t2.quiet(4, 30)
        log('S4 повторный --session-id с тем же uuid (ожидаем ошибку?)', t2.tail(12))
    finally:
        t2.close()
    t3 = Term(['--model', MODEL, '--resume', sid], proj)
    try:
        t3.start()
        turn(t3, 'Какое слово я просил запомнить? Ответь одним словом', 'S4 --resume')
    finally:
        t3.close()


def term_program():
    for label, extra, unset in [('TERM_PROGRAM не задан', {}, ('TERM_PROGRAM', 'TERM_PROGRAM_VERSION')), ('TERM_PROGRAM=Apple_Terminal', {'TERM_PROGRAM': 'Apple_Terminal'}, ()),
                                ('TERM_PROGRAM=TClaude-Orch', {'TERM_PROGRAM': 'TClaude-Orch'}, ())]:
        t = Term(['--model', MODEL], proj, extra, unset)
        try:
            t.start()
            m = t.mark()
            t.send('Ответь одним словом: ok')
            time.sleep(0.4)
            t.send('\r')
            t.quiet(4, 60)
            codes = sorted({c for _, _, c, _ in t.events})
            log(f'S1 {label}', f'коды OSC за запуск: {codes}\n--- ход ---\n{t.since(m)}')
        finally:
            t.close()


try:
    run('flags', flags)
    run('osc', osc_and_stop)
    run('resume', resume)
    run('term', term_program)
finally:
    open(REPORT, 'w').write(''.join(out))
    if not os.environ.get('SPIKE_KEEP'):
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'\nОтчёт: {REPORT}  (всего {time.time() - T0:.0f} с)')
