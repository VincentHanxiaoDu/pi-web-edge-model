/** Engine launch contracts; each port remains loopback-only behind the gateway. */
import { PATHS } from './device.js';
import { q, fileName, contextSize } from './validation.js';
export const ENGINES = Object.freeze({
  llamacpp: {
    label: 'llama.cpp · Hexagon', port: 9380, healthPath: '/health',
    start: (m, idle) => `${PATHS.edgeBin}/llama-serve-start ${q(fileName(m.file.split('/').at(-1)))} ${contextSize(m.contextWindow)} ${idle}`,
  },
  litert: { label: 'LiteRT-LM', port: 9379, healthPath: '/v1/models',
    start: () => `${PATHS.edgeBin}/litert-serve-start` },
});
export async function isUp(id) {
  try { return (await fetch(`http://127.0.0.1:${ENGINES[id].port}${ENGINES[id].healthPath}`, { signal: AbortSignal.timeout(2000) })).ok; }
  catch { return false; }
}
export async function stopEngine(device, id, signal) {
  if (!Object.hasOwn(ENGINES, id)) throw new Error('Unknown engine');
  await device.shell(`${PATHS.edgeBin}/edge-stop ${id}`, signal);
}
export async function waitUp(id, signal) {
  for (let i = 0; i < 120; i++) {
    signal?.throwIfAborted();
    if (await isUp(id)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${ENGINES[id].label} did not become ready; inspect its device log`);
}
