/** Device inventory plus scoped metadata; an unavailable adb never masquerades as an empty list. */
import { PATHS } from './device.js';
import { fileName, checkedModelFile, apiModelId, humanSize } from './validation.js';
export { humanSize } from './validation.js';

export async function listCatalog(device, store, signal) {
  await device.connect(signal);
  const source = `
for f in ${PATHS.gguf}/*.gguf; do
  [ -f "$f" ] || continue
  printf 'llamacpp\t%s\t%s\t%s\n' "$(basename "$f" .gguf)" "$(stat -c %s "$f")" "$(readlink -f "$f")"
done
for f in ${PATHS.litertHome}/models/*/model.litertlm; do
  [ -f "$f" ] || continue
  printf 'litert\t%s\t%s\t%s\n' "$(basename "$(dirname "$f")")" "$(stat -Lc %s "$f")" "$(readlink -f "$f")"
done
printf 'config\t'; if [ -f ${PATHS.litertHome}/config.json ]; then cat ${PATHS.litertHome}/config.json; else printf '{}'; fi
`;
  const raw = await device.shell(source, signal);
  const boundary = raw.indexOf('config\t');
  if (boundary < 0) throw new Error('Incomplete device inventory');
  const config = JSON.parse(raw.slice(boundary + 7));
  const meta = await store.models();
  return raw.slice(0, boundary).trim().split('\n').filter(Boolean).map((line) => {
    const [engine, name, size, path] = line.split('\t');
    fileName(name);
    const file = checkedModelFile(engine, path);
    const id = `${engine}:${name}`;
    const saved = meta[id] ?? {};
    const configured = config.models?.[name] ?? {};
    const base = { id, engine, name, file, sizeBytes: Number(size), sizeLabel: humanSize(Number(size)),
      contextWindow: saved.contextWindow ?? configured.max_num_tokens ?? (engine === 'llamacpp' ? 8192 : 2048),
      backend: saved.backend ?? configured.backend ?? 'npu', inPi: saved.inPi === true,
      benchmark: saved.benchmark ?? null, note: saved.note ?? null };
    return { ...base, apiId: apiModelId(base) };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export async function deviceResources(device, signal) {
  const raw = await device.shell('cat /proc/meminfo | head -3; df -k /data | tail -1', signal);
  const available = Number(/MemAvailable:\s+(\d+)/.exec(raw)?.[1]);
  const total = Number(/MemTotal:\s+(\d+)/.exec(raw)?.[1]);
  const disk = raw.trim().split('\n').at(-1).split(/\s+/);
  return { memory: { totalBytes: total * 1024, availableLabel: humanSize(available * 1024) },
    space: { freeLabel: humanSize(Number(disk[3]) * 1024) } };
}
