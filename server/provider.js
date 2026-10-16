/** Write exactly providers.litert, never expose or log the credential-bearing document. Invalid JSON is refused. */
import { readFile, rename, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function providerPaths(home = homedir()) {
  return { modelsPath: join(home, '.pi/agent/models.json') };
}
async function documentAt(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || (doc.providers && (typeof doc.providers !== 'object' || Array.isArray(doc.providers)))) throw new Error('Invalid models.json document');
    return { doc, raw };
  } catch (e) {
    if (e.code === 'ENOENT') return { doc: {}, raw: null };
    throw new Error('Refusing to overwrite unreadable or invalid models.json');
  }
}
export async function readProvider(home = homedir()) {
  const { doc } = await documentAt(providerPaths(home).modelsPath);
  return doc.providers?.litert;
}
export function providerBlock({ port, models }) {
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'edge-models-local',
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStore: false, supportsUsageInStreaming: false, maxTokensField: 'max_tokens' },
    models: models.filter((m) => m.inPi).map((m) => ({ id: m.apiId, name: `${m.name} (${m.engine})`,
      input: ['text'], reasoning: false, contextWindow: m.contextWindow, maxTokens: Math.min(4096, Math.floor(m.contextWindow / 2)),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
  };
}
export async function syncProvider({ port, models, home = homedir() }) {
  const { modelsPath } = providerPaths(home);
  const { doc, raw } = await documentAt(modelsPath);
  await mkdir(join(home, '.pi/agent'), { recursive: true, mode: 0o700 });
  if (raw !== null) {
    const backup = `${modelsPath}.bak-edge-models`;
    try { await writeFile(backup, raw, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    await chmod(backup, 0o600);
  }
  doc.providers = { ...doc.providers, litert: providerBlock({ port, models }) };
  const tmp = `${modelsPath}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(tmp, modelsPath);
  return { ids: doc.providers.litert.models.map((m) => m.id) };
}
