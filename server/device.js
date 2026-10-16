/** uid shell owns NPU access. Keep adb argv separate from shell source; quote every data argument. */
import { fileURLToPath } from 'node:url';
import { q } from './validation.js';
export { q } from './validation.js';
export const PATHS = Object.freeze({
  llamaRoot: '/data/local/tmp/llama', gguf: '/data/local/tmp/llama/gguf',
  litertRoot: '/data/local/tmp/llm', litertHome: '/data/local/tmp/llm/home/.litert-lm',
  edgeBin: '/data/local/tmp/edge-models/bin',
});
export function createDevice(execFile, settings = {}) {
  const serial = settings.adbSerial ?? '127.0.0.1:5555';
  if (!/^127\.0\.0\.1:\d{1,5}$/.test(serial)) throw new Error('adbSerial must be a loopback address');
  const run = async (file, args, signal = AbortSignal.timeout(18000)) => {
    const r = await execFile({ file, args, timeoutMs: 15000, signal });
    if (r.exitCode !== 0 || r.stdoutTruncated || r.stderrTruncated) throw new Error(`${file}: ${r.stderr.trim().slice(0, 240) || `exit ${r.exitCode}`}`);
    return r.stdout;
  };
  async function connect(signal) {
    await run('adb', ['connect', serial], signal);
    const state = await run('adb', ['-s', serial, 'get-state'], signal);
    if (state.trim() !== 'device') throw new Error('ADB unavailable: enable debugging and pair this Termux first');
  }
  const shell = (source, signal) => run('adb', ['-s', serial, 'shell', source], signal);
  async function install(signal) {
    await connect(signal);
    await shell(`mkdir -p ${PATHS.edgeBin} /data/local/tmp/py/bin`, signal);
    const scripts = {
      'llama-serve-start': PATHS.edgeBin, 'litert-serve-start': PATHS.edgeBin, 'edge-stop': PATHS.edgeBin,
      'litert-lm-shell': '/data/local/tmp/py/bin', 'litert_npu_cli.py': '/data/local/tmp/py/bin',
    };
    for (const [name, dir] of Object.entries(scripts)) {
      const src = fileURLToPath(new URL(`../device/${name}`, import.meta.url));
      await run('adb', ['-s', serial, 'push', src, `${dir}/${name}`], signal);
    }
    await shell(`chmod 755 ${Object.entries(scripts).map(([n, d]) => q(`${d}/${n}`)).join(' ')}`, signal);
  }
  return { serial, run, connect, shell, install };
}
