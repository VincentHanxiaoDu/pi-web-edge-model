/** Detached job worker. Its JSON is durable truth; exit 0 is never inferred from a trailing pipe. */
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, stat, open, unlink, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileName, modelPath, q } from '../server/validation.js';

const path = process.argv[2];
let job = JSON.parse(await readFile(path, 'utf8'));
let child;
const save = async (patch) => {
  job = { ...job, ...patch, updatedAt: new Date().toISOString() };
  await writeFile(`${path}.tmp`, JSON.stringify(job), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
};
const run = (file, args) => new Promise((resolve, reject) => {
  child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const append = (chunk) => { out = (out + chunk.toString()).slice(-20000); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  child.once('error', reject);
  child.once('close', (code, signal) => code === 0 ? resolve(out) : reject(new Error(`${file} failed (${code ?? signal}): ${out.slice(-600)}`)));
});
const shell = (source) => run('adb', ['-s', job.serial, 'shell', source]);

async function download() {
  const dir = join(dirname(path), '..', 'downloads');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const local = join(dir, `${job.id}-${job.file}.part`);
  const url = `https://huggingface.co/${job.repo}/resolve/main/${job.file}`;
  const metadataResponse = await fetch(`https://huggingface.co/api/models/${job.repo}?blobs=true`, { signal: AbortSignal.timeout(30000) });
  if (!metadataResponse.ok) throw new Error(`HuggingFace metadata HTTP ${metadataResponse.status}; only public repos are supported`);
  const metadata = await metadataResponse.json();
  const entry = metadata.siblings?.find((s) => s.rfilename === job.file);
  if (!entry || !Number.isSafeInteger(entry.size) || entry.size <= 1024) throw new Error('Model file not found or size unknown');
  await save({ state: 'downloading', total: entry.size, bytes: 0, step: 'Fetching from HuggingFace' });
  for (let attempt = 0; attempt < 12; attempt++) {
    let timer;
    try {
      timer = setInterval(() => { stat(local).then((s) => { job.bytes = s.size; }).catch(() => {}); }, 1000);
      const progress = setInterval(() => { writeFile(`${path}.progress`, String(job.bytes)).catch(() => {}); }, 2000);
      try {
        await run('curl', ['-q', '-fLsS', '-C', '-', '--connect-timeout', '15', '--max-time', '120', '--speed-limit', '20000', '--speed-time', '30', '-o', local, url]);
      } finally { clearInterval(progress); }
      break;
    } catch (e) {
      if (attempt === 11) throw e;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } finally { clearInterval(timer); }
  }
  const size = (await stat(local)).size;
  if (size !== entry.size) throw new Error(`Size mismatch: got ${size}, expected ${entry.size}`);
  const handle = await open(local, 'r');
  const header = Buffer.alloc(8);
  await handle.read(header, 0, 8, 0); await handle.close();
  const magic = job.engine === 'llamacpp' ? 'GGUF' : 'LITERTLM';
  if (!header.toString('ascii').startsWith(magic)) throw new Error('Downloaded file is not a model (invalid header)');
  if (entry.lfs?.sha256) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(local)) hash.update(chunk);
    if (hash.digest('hex') !== entry.lfs.sha256) throw new Error('SHA-256 mismatch');
  }
  const final = modelPath(job.engine, job.file);
  const temporary = `${final}.${job.id}.part`;
  await save({ state: 'pushing', bytes: size, step: 'Pushing verified model to adb shell storage' });
  await shell(`mkdir -p ${q(dirname(final))}; test ! -e ${q(final)}`);
  await run('adb', ['-s', job.serial, 'push', local, temporary]);
  let installed = temporary;
  let installedName = job.file;
  if (job.quantize) {
    installedName = fileName(job.file.replace(/\.gguf$/, '-Q4_0.gguf'));
    installed = `${modelPath(job.engine, installedName)}.${job.id}.part`;
    await shell(`test ! -e ${q(modelPath(job.engine, installedName))}`);
    await save({ state: 'quantizing', step: 'Requantizing to Q4_0' });
    await shell(`B=$(ls -d /data/local/tmp/llama/llama-b* | sort | tail -1); LD_LIBRARY_PATH="$B/lib" timeout 600 "$B/bin/llama-quantize" --allow-requantize ${q(temporary)} ${q(installed)} Q4_0 6`);
    await shell(`rm -f ${q(temporary)}`);
  }
  await shell(`test -s ${q(installed)} && mv ${q(installed)} ${q(modelPath(job.engine, installedName))}`);
  await unlink(local);
  await save({ state: 'done', file: installedName, step: 'Downloaded; awaiting registration' });
}

async function benchmark() {
  await save({ state: 'running', step: 'Benchmarking; inference is paused' });
  let output;
  if (job.engine === 'llamacpp') {
    output = await shell(`B=$(ls -d /data/local/tmp/llama/llama-b* | sort | tail -1); LD_LIBRARY_PATH="$B/lib" ADSP_LIBRARY_PATH="$B/lib" timeout 600 "$B/bin/llama-bench" -m ${q(job.model.file)} --device HTP0 -ngl 99 -t 6 -p 128 -n 64 -r 1 -fa 1`);
  } else {
    output = await shell(`cd /data/local/tmp/llm && LD_LIBRARY_PATH=. ADSP_LIBRARY_PATH=. timeout 600 ./lbench ${q(job.model.file)} ${job.model.backend === 'gpu' ? 'gpu' : 'npu'} /data/local/tmp/llm 256 128`);
  }
  const table = (test) => {
    const line = output.split('\n').find((s) => s.includes(`|`) && s.includes(test));
    return Number(line?.split('|').at(-2)?.trim().split(/\s/)[0]);
  };
  const measure = (label) => Number(new RegExp(`^${label}.*?@\\s*([0-9.]+)`, 'm').exec(output)?.[1]);
  const prefill = job.engine === 'llamacpp' ? table('pp128') : measure('prefill');
  const decode = job.engine === 'llamacpp' ? table('tg64') : measure('decode');
  if (!(prefill > 0 && decode > 0)) throw new Error(`No benchmark measurements: ${output.slice(-500)}`);
  await save({ state: 'done', step: 'Benchmark complete', result: { prefill, decode, at: new Date().toISOString() } });
}

try {
  await run('adb', ['connect', job.serial]);
  if (job.kind === 'download') await download(); else await benchmark();
} catch (e) {
  await save({ state: 'failed', error: String(e.message).slice(-700), step: 'Failed' });
  process.exitCode = 1;
}
