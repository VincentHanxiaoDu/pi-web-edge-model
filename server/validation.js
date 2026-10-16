/** Inputs crossing the browser/device boundary are names, never shell programs or arbitrary paths. */
export const ENGINE_IDS = ['llamacpp', 'litert'];
export function fileName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value)) throw new Error('Invalid file or model name');
  return value;
}
export function repoName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error('Use a public HuggingFace repo: owner/name');
  return value;
}
export function contextSize(value) {
  if (!Number.isSafeInteger(Number(value)) || value < 256 || value > 32768) throw new Error('Context must be 256–32768 tokens');
  return Number(value);
}
export function engineForFile(file) {
  fileName(file);
  if (file.endsWith('.gguf')) return 'llamacpp';
  if (file.endsWith('.litertlm')) return 'litert';
  throw new Error('Choose a .gguf or .litertlm file');
}
export function q(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
export function modelPath(engine, file) {
  fileName(file);
  const roots = { llamacpp: '/data/local/tmp/llama/gguf', litert: '/data/local/tmp/llm' };
  if (!Object.hasOwn(roots, engine)) throw new Error('Unknown engine');
  return `${roots[engine]}/${file}`;
}
export function checkedModelFile(engine, path) {
  const root = modelPath(engine, 'sentinel').slice(0, -8);
  if (!path.startsWith(root)) throw new Error('Model is outside managed device storage');
  return modelPath(engine, path.slice(root.length));
}
export function apiModelId(model) { return `${model.engine}--${fileName(model.name)}`; }
export function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const power = bytes ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}
