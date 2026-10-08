#!/usr/bin/env node
/**
 * nessy-orch — лёгкий оркестратор поверх `nessy serve`.
 * HTTP-демон на 127.0.0.1: поднимает по одному `nessy serve` на воркспейс,
 * принимает задачи (POST /ask), ведёт реестр задач и сессий, проксирует
 * SSE-события nessy в UI и в CLI.
 *
 * Без внешних зависимостей (чистый Node http).
 */
'use strict';

const http = require('http');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const ORCH_PORT = parseInt(process.env.ORCH_PORT || '4337', 10);
const SERVE_BASE_PORT = parseInt(process.env.SERVE_BASE_PORT || '4341', 10);
const NESSY_BIN = process.env.NESSY_BIN || '/Users/a.s.obraztsov/.local/bin/nessy';
const MAX_LOG = parseInt(process.env.MAX_LOG || '5000', 10); // событий на сессию
const serveProbeTimeout = 30000;

// ---------- helpers ----------
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};
const sendSSE = (res, data, event) => {
  res.write(`event: ${event || 'message'}\ndata: ${JSON.stringify(data)}\n\n`);
};

function getBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ---------- HTTP клиент-помощник (к nessy serve) ----------
function httpJson(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: p,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { resolve({ status: res.statusCode, json: d ? JSON.parse(d) : {} }); }
        catch (e) { resolve({ status: res.statusCode, json: { raw: d } }); }
      }); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function waitForHealth(port, timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      httpJson(port, 'GET', '/health').then((r) => {
        if (r.status === 200) return resolve(true);
        if (Date.now() - t0 > timeoutMs) return resolve(false);
        setTimeout(tick, 300);
      }).catch(() => { if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(tick, 300); });
    };
    tick();
  });
}

// ---------- Serve-менеджер ----------
// serves: Map<workspace, {port, proc, url, ready, sessionId}>
const serves = new Map();
let serveIdx = 0;

function getServe(workspace) {
  if (serves.has(workspace)) return serves.get(workspace);
  const port = SERVE_BASE_PORT + serveIdx++;
  const url = `http://127.0.0.1:${port}`;
  console.log(`[orch] spawn nessy serve for workspace=${workspace} port=${port}`);
  const proc = spawn(NESSY_BIN, ['serve', '--port', String(port), '--hostname', '127.0.0.1', '--no-web', '--workspace', workspace], {
    cwd: workspace, env: { ...process.env }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[serve:${port}] ${d}`));
  proc.on('exit', (code) => { console.log(`[orch] serve port=${port} exited code=${code}`); serves.delete(workspace); });
  const rec = { workspace, port, url, proc, ready: false, sessionId: null };
  serves.set(workspace, rec);
  waitForHealth(port, serveProbeTimeout).then((ok) => { rec.ready = ok; if (!ok) console.log(`[orch] serve port=${port} not ready`); });
  return rec;
}

// ---------- SSE-клиент к serve (сбор событий сессии) ----------
// sessionLogs: Map<workspace, events[]>
const sessionLogs = new Map();
// сессия на воркспейс: sessionId
function attachSessionStream(workspace) {
  const serve = getServe(workspace);
  const key = workspace;
  if (!sessionLogs.has(key)) {
    sessionLogs.set(key, []);
    setTimeout(() => startSessionStream(key, serve), 500); // дать демону подняться
  }
  return sessionLogs.get(key);
}

function startSessionStream(key, serve) {
  const ws = serve.workspace;
  // если сессии ещё нет — ждём первого POST /session и переподписываемся
  pollSessionId(ws, serve, (sessionId) => {
    serve.sessionId = sessionId;
    console.log(`[orch] session for ${ws}: ${sessionId}`);
    openSSE(key, serve, sessionId);
  });
}

function pollSessionId(ws, serve, cb, tried) {
  tried = tried || 0;
  if (serve.sessionId) return cb(serve.sessionId);
  // создать/приаттачиться к сессии workspace
  httpJson(serve.port, 'POST', '/session', { cwd: ws }).then((r) => {
    if (r.json && r.json.sessionId) { serve.sessionId = r.json.sessionId; cb(r.json.sessionId); }
    else if (tried < 20) setTimeout(() => pollSessionId(ws, serve, cb, tried + 1), 1000);
    else console.log(`[orch] не смог создать сессию для ${ws}`);
  }).catch(() => { if (tried < 20) setTimeout(() => pollSessionId(ws, serve, cb, tried + 1), 1000); });
}

function openSSE(key, serve, sessionId) {
  const log = sessionLogs.get(key);
  const req = http.get({ host: '127.0.0.1', port: serve.port, path: `/session/${sessionId}/events`, headers: { Accept: 'text/event-stream' } }, (res) => {
    let buf = '';
    let lastEventId = null;
    res.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const lines = frame.split('\n');
        let data = '', ev = 'message';
        for (const ln of lines) {
          if (ln.startsWith('id:')) lastEventId = ln.slice(3).trim();
          else if (ln.startsWith('event:')) ev = ln.slice(6).trim();
          else if (ln.startsWith('data:')) data += ln.slice(5).trim();
        }
        if (!data) continue;
        try {
          const msg = JSON.parse(data);
          pushEvent(log, { id: lastEventId, event: ev, ts: Date.now(), data: msg });
          handleSessionEvent(key, serve, msg);
        } catch (e) { /* ignore */ }
      }
    });
    res.on('close', () => {
      // переподключение (replay начнётся заново, ring возьмёт последние)
      if (serve.sessionId && serves.has(serve.workspace)) {
        setTimeout(() => openSSE(key, serve, serve.sessionId), 1000);
      }
    });
    res.on('error', () => { if (serve.sessionId) setTimeout(() => openSSE(key, serve, serve.sessionId), 1000); });
  });
  req.on('error', () => { if (serve.sessionId) setTimeout(() => openSSE(key, serve, serve.sessionId), 1000); });
}

function pushEvent(log, ev) {
  log.push(ev);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
}

// ---------- Обработка событий сессии -> статусы задач ----------
// jobsBySession: sessionId -> [jobId...] (последний активный первым)
const activeJobs = new Map(); // sessionId -> jobId (текущий активный)

function handleSessionEvent(key, serve, msg) {
  const type = msg.type;
  const d = msg.data || {};
  const update = (d.update || {}).sessionUpdate;
  const content = (d.update || {}).content || {};
  const current = activeJobs.get(key);
  const job = current && jobs.get(current);

  if (type === 'turn_complete') {
    const promptId = d.promptId;
    // найти job по promptId
    let j = null;
    for (const jb of jobs.values()) if (jb.promptId === promptId) { j = jb; break; }
    if (j) {
      j.status = 'done';
      j.stopReason = d.stopReason;
      j.doneAt = new Date().toISOString();
      if (!j.answer) j.answer = lastAgentText(key);
    }
    // снять активность
    if (activeJobs.get(key) === current) activeJobs.delete(key);
  } else if (type === 'session_metadata_updated') {
    if (job) { job.displayName = d.displayName; }
  } else if (update === 'agent_message_chunk') {
    if (content.text) { if (job && !job.answer) job.answer = ''; if (job) job.answer += content.text; }
  } else if (update === 'tool_call') {
    if (job) job.lastTool = { name: (d.update._meta || {}).toolName, input: (d.update.rawInput || {}) };
  } else if (update === 'user_message_chunk') {
    if (job) job.lastUserText = content.text || '';
  }
}

function lastAgentText(key) {
  const log = sessionLogs.get(key) || [];
  let out = '';
  for (let i = log.length - 1; i >= 0 && i > log.length - 400; i--) {
    const u = (log[i].data || {}).data || {};
    if ((u.update || {}).sessionUpdate === 'agent_message_chunk' && (u.update.content || {}).text) {
      out = (u.update.content.text) + out;
    } else if (out) break;
  }
  return out;
}

// ---------- Реестр задач ----------
const jobs = new Map();
let jobSeq = 0;
const id = () => 'job_' + Date.now().toString(36) + '_' + (++jobSeq);

async function createJob({ cwd, prompt }) {
  const workspace = path.resolve(cwd || process.cwd());
  const serve = getServe(workspace);
  if (!serve.ready) { const ok = await waitForHealth(serve.port, serveProbeTimeout); if (!ok) throw new Error('serve не поднялся'); }
  const log = attachSessionStream(workspace);

  // сессия
  let sessionId = serve.sessionId;
  if (!sessionId) {
    const r = await httpJson(serve.port, 'POST', '/session', { cwd: workspace });
    sessionId = r.json.sessionId;
    if (!sessionId) throw new Error('не создалась сессия: ' + JSON.stringify(r.json));
    serve.sessionId = sessionId;
  }

  // промпт
  const pr = await httpJson(serve.port, 'POST', `/session/${sessionId}/prompt`, { prompt: [{ type: 'text', text: prompt }] });
  const promptId = pr.json.promptId;

  const jid = id();
  const job = { id: jid, workspace, prompt, sessionId, promptId, status: 'running', displayName: null, answer: '', lastTool: null, lastUserText: null, createdAt: new Date().toISOString(), doneAt: null, stopReason: null };
  jobs.set(jid, job);
  activeJobs.set(workspace, jid);
  console.log(`[orch] job ${jid} workspace=${workspace} session=${sessionId} promptId=${promptId}`);
  return job;
}

// ---------- HTTP-сервер ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveUI(res);
    if (req.method === 'GET' && p === '/health') return json(res, 200, { status: 'ok' });

    if (req.method === 'POST' && p === '/ask') {
      const body = await getBody(req);
      const prompt = (body.prompt || '').toString();
      if (!prompt.trim()) return json(res, 400, { error: 'prompt required' });
      const job = await createJob({ cwd: body.cwd, prompt });
      return json(res, 200, { job_id: job.id, session_id: job.sessionId, status: job.status });
    }

    if (req.method === 'GET' && p === '/jobs') {
      const list = [...jobs.values()].map((j) => ({ id: j.id, workspace: j.workspace, status: j.status, displayName: j.displayName, prompt: j.prompt, lastTool: j.lastTool, createdAt: j.createdAt, doneAt: j.doneAt }));
      return json(res, 200, list);
    }

    if (req.method === 'GET' && p === '/sessions') {
      const out = [];
      for (const [ws, log] of sessionLogs) out.push({ workspace: ws, sessionId: serves.get(ws)?.sessionId || null, events: log.slice(-200) });
      return json(res, 200, out);
    }

    let m = p.match(/^\/job\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(decodeURIComponent(m[1]));
      if (!job) return json(res, 404, { error: 'not found' });
      return json(res, 200, { ...job, log: (sessionLogs.get(job.workspace) || []).slice(-500) });
    }

    m = p.match(/^\/job\/([^/]+)\/events$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(decodeURIComponent(m[1]));
      if (!job) return json(res, 404, { error: 'not found' });
      // SSE живой лог задачи (из сессии)
      const log = sessionLogs.get(job.workspace) || [];
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      // replay последних
      for (const ev of log.slice(-50)) sendSSE(res, ev.data, ev.event);
      sendSSE(res, { type: 'replay_complete', job_id: job.id }, 'replay_complete');
      const timer = setInterval(() => res.write(': hb\n\n'), 15000);
      const push = (ev) => sendSSE(res, ev.data, ev.event);
      // подписка на новые события сессии
      const watchers = sessionWatchers.get(job.workspace) || [];
      watchers.push(push);
      sessionWatchers.set(job.workspace, watchers);
      const jobDone = () => { if (job.status === 'done' || job.status === 'error') { clearInterval(timer); } };
      const iv = setInterval(jobDone, 2000);
      req.on('close', () => {
        clearInterval(timer); clearInterval(iv);
        const arr = sessionWatchers.get(job.workspace) || [];
        sessionWatchers.set(job.workspace, arr.filter((f) => f !== push));
      });
      return;
    }

    return json(res, 404, { error: 'not found', path: p });
  } catch (e) {
    json(res, 500, { error: String(e && e.message || e) });
  }
});

// watchers для live-SSE в UI/CLI (per workspace)
const sessionWatchers = new Map();
// пробросить новые события сессии в watchers
const origPushEvent = pushEvent;
pushEvent = function (log, ev) {
  origPushEvent(log, ev);
  const ws = [...sessionLogs.entries()].find(([, l]) => l === log)?.[0];
  if (ws) for (const w of (sessionWatchers.get(ws) || [])) { try { w(ev); } catch (e) {} }
};

// ---------- UI ----------
function serveUI(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>nessy-orch</title>
<style>
body{font-family:ui-monospace,Menlo,monospace;background:#0f1115;color:#d6dae2;margin:0;padding:20px}
h1{font-size:16px;color:#8ab4ff}
table{border-collapse:collapse;width:100%;margin-top:10px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #22262e;font-size:12px;vertical-align:top}
th{color:#7d8590;font-weight:600}
.status-running{color:#ffd479}.status-done{color:#7ee2a8}.status-error{color:#ff7b72}.status-queued{color:#9ecbff}
pre{background:#151a21;padding:10px;border-radius:6px;font-size:11px;overflow:auto;color:#c9d1d9}
.ev-tool{color:#ffab70}.ev-thought{color:#8b949e;font-style:italic}.ev-msg{color:#7ee2a8}.ev-sys{color:#7d8590}
a{color:#8ab4ff;cursor:pointer}
.job{border:1px solid #22262e;border-radius:6px;padding:10px;margin-bottom:10px}
.toolbar{margin:10px 0}
button{background:#1f2630;color:#d6dae2;border:1px solid #30363d;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px}
</style></head><body>
<h1>nessy-orch — оркестратор nessy</h1>
<div class="toolbar"><button onclick="loadJobs()">Обновить задачи</button> <button onclick="loadSessions()">Обновить сессии</button></div>
<div id="jobs"><i>загружаю…</i></div>
<div id="sessions"></div>
<script>
async function j(url){const r=await fetch(url);return r.json()}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function renderEv(ev){
  const d=ev.data||{}; const u=(d.data||{}).update||{};
  const su=u.sessionUpdate; const c=u.content||{};
  if(su==='agent_message_chunk')return '<span class="ev-msg">▸ '+(esc(c.text||''))+'</span>';
  if(su==='agent_thought_chunk')return '<span class="ev-thought">… '+(esc(c.text||''))+'</span>';
  if(su==='tool_call'){const t=(u._meta||{}).toolName||'?';return '<span class="ev-tool">⚙ '+esc(t)+' '+esc(JSON.stringify(u.rawInput||{}).slice(0,200))+'</span>';}
  if(su==='tool_call_update'){const t=(u._meta||{}).toolName||'?';return '<span class="ev-tool">✔ '+esc(t)+' '+esc(JSON.stringify(u.content||{}).slice(0,200))+'</span>';}
  if(d.type==='turn_complete')return '<span class="ev-sys">[done: '+esc(d.data.stopReason)+']</span>';
  return '';
}
function jobCard(j){
  return '<div class="job"><div><b>'+esc(j.id)+'</b> <span class="status-'+esc(j.status)+'">'+esc(j.status)+'</span> '+esc(j.workspace)+'</div>'+
  '<div style="color:#7d8590;font-size:11px">'+esc(j.prompt||'').slice(0,140)+'</div>'+
  (j.lastTool?'<div style="font-size:11px">последний инструмент: '+esc(j.lastTool.name)+'</div>':'')+
  (j.answer?'<pre>'+esc(j.answer).slice(-600)+'</pre>':'')+'</div>';
}
async function loadJobs(){
  const list=await j('/jobs');
  document.getElementById('jobs').innerHTML=list.length?list.map(jobCard).join(''):'<i>задач нет</i>';
}
async function loadSessions(){
  const list=await j('/sessions');
  document.getElementById('sessions').innerHTML='<h1 style="font-size:14px">Сессии / события</h1>'+list.map(s=>
    '<div class="job"><b>'+esc(s.workspace)+'</b> · <span style="color:#7d8590">'+esc(s.sessionId)+'</span>'+
    '<pre>'+s.events.slice(-120).map(renderEv).join('\\n')+'</pre></div>').join('');
}
setInterval(loadJobs,3000);setInterval(loadSessions,3000);loadJobs();loadSessions();
</script></body></html>`);
}

server.listen(ORCH_PORT, '127.0.0.1', () => console.log(`[orch] listening on http://127.0.0.1:${ORCH_PORT}`));
process.on('SIGTERM', () => { for (const s of serves.values()) s.proc.kill('SIGTERM'); process.exit(0); });
process.on('SIGINT', () => process.emit('SIGTERM'));