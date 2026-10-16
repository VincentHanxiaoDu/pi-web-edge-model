/** Small dependency-free sanity check; phone/UI verification remains the integration gate. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fileName, repoName, contextSize, modelPath, checkedModelFile, q, apiModelId } from '../server/validation.js';
import { providerPaths, syncProvider } from '../server/provider.js';
import { createStore } from '../server/store.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function syntax(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await syntax(p);
    else if (/\.(m?js)$/.test(e.name)) assert.equal(spawnSync(process.execPath, ['--check', p]).status, 0, p);
  }
}
await syntax(root);
for (const bad of ['../secret', '-o', '', 'a/b', 'a;rm', 'a\nfile']) assert.throws(() => fileName(bad));
assert.equal(fileName('Gemma-4.Q4_0.gguf'), 'Gemma-4.Q4_0.gguf');
assert.throws(() => repoName('https://evil/a')); assert.throws(() => contextSize(NaN));
assert.throws(() => checkedModelFile('llamacpp', '/data/local/tmp/llama/gguf/../../etc/passwd'));
assert.equal(checkedModelFile('litert', '/data/local/tmp/llm/a.litertlm'), modelPath('litert', 'a.litertlm'));
assert.equal(q("x'y"), "'x'\\''y'");
const data = new Map();
const store = createStore({ read: async (k) => data.get(k), write: async (k, v) => data.set(k, v) });
await Promise.all([store.patch('a', { inPi: true }), store.patch('b', { inPi: false })]);
assert.equal(Object.keys(await store.models()).length, 2);
const home = await mkdtemp(join(tmpdir(), 'edge-model-check-'));
try {
  await mkdir(join(home, '.pi/agent'), { recursive: true });
  const path = providerPaths(home).modelsPath;
  const original = { providers: { unrelated: { apiKey: 'test-only-do-not-publish-real-keys', models: [] } }, custom: 123 };
  await writeFile(path, JSON.stringify(original));
  const m = { engine: 'llamacpp', name: 'example-Q4_0', contextWindow: 8192, inPi: true };
  m.apiId = apiModelId(m);
  await syncProvider({ home, port: 9390, models: [m] });
  const result = JSON.parse(await readFile(path));
  assert.deepEqual(result.providers.unrelated, original.providers.unrelated);
  assert.equal(result.custom, 123);
  assert.equal(result.providers.litert.models[0].id, 'llamacpp--example-Q4_0');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await writeFile(path, '{broken');
  await assert.rejects(syncProvider({ home, port: 9390, models: [] }), /Refusing/);
  assert.equal(await readFile(path, 'utf8'), '{broken');
} finally { await rm(home, { recursive: true, force: true }); }
console.log('Syntax, boundary validation, scoped state and credential-preserving provider writes: OK');
