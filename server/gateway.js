/**
 * Owns residency for the entire lifetime of each request, not merely during model loading.
 * Otherwise a concurrent switch could kill a stream or make one model answer for another.
 * Only one engine is resident; adbd restarts are recovered on the next request or heartbeat.
 */
import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ENGINES, isUp, stopEngine, waitUp } from './engines.js';

export function createGateway({ device, log, settings, catalog, blocked }) {
  const port = Number(settings.gatewayPort ?? 9390);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid gateway port');
  const idleSeconds = 600;
  let server, resident = null, tail = Promise.resolve(), activity = null;
  const lifetime = new AbortController();
  const exclusive = (work) => {
    const next = tail.then(work, work);
    tail = next.catch(() => {});
    return next;
  };
  const status = () => ({ port, listening: Boolean(server?.listening), resident, activity });

  async function unloadInside(signal) {
    await device.connect(signal);
    for (const id of Object.keys(ENGINES)) await stopEngine(device, id, signal);
    resident = null;
  }
  async function ensure(model, signal) {
    if (await blocked()) throw new Error('A benchmark or conversion is active; try again when it finishes');
    if (resident?.id === model.id && resident.contextWindow === model.contextWindow && await isUp(model.engine)) return;
    activity = `Loading ${model.name}`;
    await unloadInside(signal);
    const start = ENGINES[model.engine].start(model, idleSeconds);
    await device.shell(start, signal);
    await waitUp(model.engine, signal);
    resident = { id: model.id, name: model.name, engine: model.engine, contextWindow: model.contextWindow, at: new Date().toISOString() };
  }
  async function runWithActivity(label, fn) {
    activity = label;
    try { return await fn(); } finally { activity = null; }
  }
  async function load(model) {
    return exclusive(() => runWithActivity(`Loading ${model.name}`, () => ensure(model, lifetime.signal)));
  }
  async function unload() {
    return exclusive(() => runWithActivity('Unloading', () => unloadInside(lifetime.signal)));
  }
  async function recover() {
    if (!resident || activity || await isUp(resident.engine)) return;
    const wanted = resident;
    await exclusive(async () => {
      if (resident?.id !== wanted.id || await isUp(wanted.engine)) return;
      const model = (await catalog()).find((m) => m.id === wanted.id);
      if (model) await runWithActivity('Recovering after adb restart', () => ensure(model, lifetime.signal));
    });
  }
  async function handle(req, res) {
    const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    if (req.method === 'GET' && path === '/health') return json(res, 200, status());
    if (req.method === 'GET' && path === '/v1/models') {
      const models = await catalog();
      return json(res, 200, { object: 'list', data: models.filter((m) => m.inPi).map((m) => ({ id: m.apiId, object: 'model', owned_by: m.engine, created: 0 })) });
    }
    if (req.method !== 'POST' || path !== '/v1/chat/completions') return json(res, 404, { error: { message: 'Unsupported gateway endpoint' } });
    const data = await body(req);
    if (typeof data.model !== 'string' || !Array.isArray(data.messages)) return json(res, 400, { error: { message: 'model and messages are required' } });
    const abort = new AbortController();
    const disconnect = () => { if (!res.writableFinished) abort.abort(); };
    res.on('close', disconnect);
    const signal = AbortSignal.any([abort.signal, lifetime.signal, AbortSignal.timeout(600000)]);
    try {
      await exclusive(async () => {
        signal.throwIfAborted();
        const model = (await catalog()).find((m) => m.apiId === data.model && m.inPi);
        if (!model) return json(res, 404, { error: { message: 'Requested model is missing or not offered to Pi' } });
        await runWithActivity(`Serving ${model.name}`, async () => {
          await ensure(model, signal);
          activity = `Serving ${model.name}`;
          const upstream = await fetch(`http://127.0.0.1:${ENGINES[model.engine].port}/v1/chat/completions`, {
            method: 'POST', signal, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...data, model: model.name }),
          });
          res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
          if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res, { signal });
          else res.end();
        });
      });
    } finally { res.off('close', disconnect); }
  }
  async function start() {
    server = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        log.warn('Gateway request failed', { message: String(err).slice(0, 300) });
        if (res.headersSent) res.destroy();
        else json(res, err.status ?? 503, { error: { message: String(err.message).slice(0, 300) } });
      });
    });
    server.requestTimeout = 600000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  }
  async function stop() {
    lifetime.abort();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await tail;
  }
  const maintenance = (work) => exclusive(async () => { await unloadInside(lifetime.signal); return work(); });
  return { port, status, start, stop, load, unload, recover, maintenance };
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('Request exceeds 2 MiB'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
function json(res, status, payload) {
  if (res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}
