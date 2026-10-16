/** Machine-scoped operations. The gateway owns engine residency; workers own long jobs. */
import { createDevice, PATHS } from './server/device.js';
import { createStore } from './server/store.js';
import { createGateway } from './server/gateway.js';
import { createJobs } from './server/jobs.js';
import { ENGINES, isUp } from './server/engines.js';
import { deviceResources, listCatalog } from './server/catalog.js';
import { linkModel, setLitertConfig, unlinkModel } from './server/litert.js';
import { readProvider, syncProvider } from './server/provider.js';
import { repoName, fileName, contextSize, engineForFile, modelPath, q } from './server/validation.js';

export default {
  apiVersion: 1, name: 'Edge models',
  activate(context) {
    const device = createDevice(context.execFile, context.settings);
    const store = createStore(context.storage);
    const lifetime = new AbortController();
    let control = null, lastError = null, timer, heartbeat = false, mutationTail = Promise.resolve();
    const catalog = (signal = lifetime.signal) => listCatalog(device, store, signal);
    const jobs = createJobs({ directory: context.storage.directory, serial: device.serial, onFinished: finalize });
    const gateway = createGateway({ device, log: context.logger, settings: context.settings, catalog, blocked: jobs.blocked });
    const mutate = (fn) => {
      const next = mutationTail.then(fn, fn);
      mutationTail = next.catch(() => {});
      return next;
    };
    async function lookup(id, signal) {
      const model = (await catalog(signal)).find((m) => m.id === id);
      if (!model) throw new Error('Model is missing on this device; refresh the list');
      return model;
    }
    async function sync(signal) {
      await seed(signal);
      const result = await syncProvider({ port: gateway.port, models: await catalog(signal) });
      await store.patchState({ providerSynced: true, lastProviderSync: new Date().toISOString() });
      return result;
    }
    async function syncIfEnabled(signal) {
      if ((await store.state()).providerSynced) await sync(signal);
    }
    async function seed(signal) {
      if ((await store.state()).seeded) return;
      const current = await readProvider();
      const models = await catalog(signal);
      for (const model of models) {
        const old = current?.models?.find((m) => m.id === model.name || m.id === model.apiId);
        const experimental = model.engine === 'litert' && /qwen3|gemma-3-1b/.test(model.name);
        await store.patch(model.id, {
          inPi: Boolean(old) && !experimental,
          contextWindow: old?.contextWindow ?? model.contextWindow,
          note: experimental ? 'Experimental: prompts over 128 tokens failed on this phone. Keep hidden from Pi.' : null,
        });
      }
      await store.patchState({ seeded: true });
    }
    async function finalize(job) {
      if (job.kind === 'bench') return store.patch(job.model.id, { benchmark: job.result });
      const name = fileName(job.file.replace(/\.(gguf|litertlm)$/, ''));
      if (job.engine === 'litert') {
        await linkModel(device, name, modelPath('litert', job.file), lifetime.signal);
        await setLitertConfig(device, name, { backend: job.backend, max_num_tokens: job.contextWindow }, lifetime.signal);
      }
      await store.patch(`${job.engine}:${name}`, { inPi: false, contextWindow: job.contextWindow });
    }
    function launch(label, action) {
      if (control) throw new Error(`Wait for ${control}`);
      control = label; lastError = null;
      void action().catch((err) => { lastError = String(err.message); context.logger.warn('Edge operation failed', { message: lastError }); }).finally(() => { control = null; });
      return { ok: true, pending: label };
    }
    const operations = {
      status: async (_, { signal }) => {
        await seed(signal);
        const models = await catalog(signal);
        const resources = await deviceResources(device, signal);
        const state = await store.state();
        const gatewayState = gateway.status();
        return {
          device: { serial: device.serial, adb: true, ...resources }, gateway: gatewayState,
          engines: Object.fromEntries(await Promise.all(Object.keys(ENGINES).map(async (id) => [id, await isUp(id)]))),
          engineLabels: Object.fromEntries(Object.entries(ENGINES).map(([id, e]) => [id, e.label])),
          models: models.map((m) => ({ ...m, resident: gatewayState.resident?.id === m.id })), jobs: await jobs.list(),
          provider: { synced: state.providerSynced === true, lastSync: state.lastProviderSync ?? null },
          control, lastError,
        };
      },
      'provider.sync': (_, { signal }) => mutate(async () => ({ ok: true, ...await sync(signal) })),
      'script.install': () => launch('Installing device launchers', () => device.install(lifetime.signal)),
      'model.load': (input) => launch('Loading model', async () => gateway.load(await lookup(input?.id))),
      'model.unload': () => launch('Unloading engines', () => gateway.unload()),
      'model.update': (input, { signal }) => mutate(async () => {
        const model = await lookup(input?.id, signal);
        const patch = {};
        if (typeof input.inPi === 'boolean') patch.inPi = input.inPi;
        if (input.contextWindow !== undefined) {
          patch.contextWindow = contextSize(input.contextWindow);
          if (model.engine === 'litert' && patch.contextWindow > model.contextWindow) throw new Error('Compiled LiteRT context cannot be increased here; import a model compiled for that size');
          if (model.engine === 'litert') await setLitertConfig(device, model.name, { max_num_tokens: patch.contextWindow }, signal);
        }
        await store.patch(model.id, patch);
        await syncIfEnabled(signal);
        return { ok: true };
      }),
      'model.delete': (input) => launch('Deleting model', () => mutate(() => gateway.maintenance(async () => {
        if ((await jobs.active()).length) throw new Error('Wait for the current job before deleting files');
        const model = await lookup(input?.id);
        if (input.confirmation !== model.name) throw new Error('Explicit model deletion confirmation required');
        const peers = (await catalog()).filter((m) => m.id !== model.id && m.file === model.file);
        if (peers.length) throw new Error('Another imported model shares this file; refusing to delete shared weights');
        if (model.engine === 'litert') await unlinkModel(device, model.name, lifetime.signal);
        await device.shell(`rm -f ${q(model.file)}`, lifetime.signal);
        await store.forget(model.id);
        await syncIfEnabled(lifetime.signal);
      }))),
      'bench.start': (input, { signal }) => mutate(async () => {
        if ((await jobs.active()).length || control) throw new Error('Wait for current work');
        const model = await lookup(input?.id, signal);
        return launch('Starting benchmark', () => gateway.maintenance(() => jobs.start({ kind: 'bench', engine: model.engine, model, file: model.name })));
      }),
      'download.start': (input, { signal }) => mutate(async () => {
        const repo = repoName(input?.repo?.trim());
        const file = fileName(input?.file?.trim());
        const engine = engineForFile(file);
        const quantize = engine === 'llamacpp' && input.quantize === true && !/Q4_0\.gguf$/i.test(file);
        const backend = input.backend === 'gpu' ? 'gpu' : 'npu';
        const contextWindow = contextSize(input.contextWindow ?? (engine === 'llamacpp' ? 8192 : 2048));
        if ((await catalog(signal)).some((m) => m.file === modelPath(engine, file))) throw new Error('File already exists; choose a different model');
        if ((await jobs.active()).length || control) throw new Error('Wait for current work');
        if (quantize) return launch('Starting download and conversion', () => gateway.maintenance(() => jobs.start({ kind: 'download', repo, file, engine, quantize, backend, contextWindow })));
        return { ok: true, job: await jobs.start({ kind: 'download', repo, file, engine, quantize, backend, contextWindow }) };
      }),
      'download.cancel': (input) => mutate(async () => ({ ok: true, job: await jobs.cancel(String(input?.id ?? '')) })),
    };
    return {
      operations,
      async start() {
        await gateway.start();
        timer = setInterval(async () => {
          if (heartbeat) return;
          heartbeat = true;
          try { await jobs.settleAll(); await gateway.recover(); }
          catch (err) { lastError = String(err.message); }
          finally { heartbeat = false; }
        }, 10000);
        timer.unref?.();
      },
      async stop() { clearInterval(timer); lifetime.abort(); await gateway.stop(); await mutationTail; },
      health: () => ({ status: gateway.status().listening ? 'healthy' : 'degraded', message: 'Local gateway; adb availability is shown on Models' }),
    };
  },
};
