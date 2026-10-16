/** Detached jobs survive plugin reloads. The worker owns terminal status; status polling only settles finished jobs. */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, rename, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ACTIVE = new Set(['queued', 'downloading', 'pushing', 'quantizing', 'running']);
export function createJobs({ directory, serial, onFinished }) {
  const dir = join(directory, 'jobs');
  const worker = fileURLToPath(new URL('../termux/job.mjs', import.meta.url));
  let settling = Promise.resolve();
  const jobPath = (id) => {
    if (!/^[a-z]+-[a-z0-9-]+$/.test(id)) throw new Error('Invalid job id');
    return join(dir, `${id}.json`);
  };
  async function alive(job) {
    try { return (await readFile(`/proc/${job.pid}/cmdline`, 'utf8')).includes(jobPath(job.id)); }
    catch { return false; }
  }
  async function save(job) {
    const path = jobPath(job.id);
    await writeFile(`${path}.manager.tmp`, JSON.stringify(job), { mode: 0o600 });
    await rename(`${path}.manager.tmp`, path);
  }
  async function list() {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const names = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    const rows = [];
    for (const name of names) {
      const job = JSON.parse(await readFile(join(dir, name), 'utf8'));
      try { job.pid = Number(await readFile(`${jobPath(job.id)}.pid`, 'utf8')); } catch {}
      if (ACTIVE.has(job.state) && Date.now() - Date.parse(job.createdAt) > 5000 && !await alive(job)) {
        job.state = 'failed'; job.error = 'Worker stopped before completion (Android may have killed it)';
        await save(job);
      }
      if (job.state === 'downloading') {
        try { job.bytes = Number(await readFile(`${jobPath(job.id)}.progress`, 'utf8')); } catch {}
      }
      rows.push(job);
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
  }
  async function active() { return (await list()).filter((j) => ACTIVE.has(j.state)); }
  async function blocked() { return (await active()).some((j) => j.kind === 'bench' || j.quantize); }
  async function start(values) {
    if ((await active()).length) throw new Error('Wait for the current job to finish');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const job = { ...values, id: `${values.kind}-${randomUUID()}`, serial, state: 'queued', bytes: 0, total: 0,
      createdAt: new Date().toISOString(), step: 'Starting', error: '', settled: false };
    const path = jobPath(job.id);
    const logfile = await open(`${path}.log`, 'a', 0o600);
    await save(job);
    const child = spawn(process.execPath, [worker, path], { detached: true, stdio: ['ignore', logfile.fd, logfile.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    await logfile.close();
    job.pid = child.pid;
    await writeFile(`${path}.pid`, String(child.pid), { mode: 0o600 });
    return { ...job, pid: child.pid };
  }
  async function settleAll() {
    const next = settling.then(async () => {
      const jobs = await list();
      for (const job of jobs) {
        if (job.state !== 'done' || job.settled) continue;
        try {
          await onFinished(job);
          await save({ ...job, settled: true, registrationError: null });
        } catch (error) { await save({ ...job, registrationError: String(error.message) }); }
      }
    });
    settling = next.catch(() => {});
    return next;
  }
  async function cancel(id) {
    const job = JSON.parse(await readFile(jobPath(id), 'utf8'));
    if (job.state !== 'downloading' && job.state !== 'queued') throw new Error('Cancellation is available only during the download stage');
    const pid = Number(await readFile(`${jobPath(id)}.pid`, 'utf8'));
    if (await alive({ ...job, pid })) process.kill(-pid, 'SIGTERM');
    await save({ ...job, pid, state: 'cancelled', step: 'Cancelled; partial download retained for inspection' });
    return { id, state: 'cancelled' };
  }
  return { list, active, blocked, start, settleAll, cancel };
}
