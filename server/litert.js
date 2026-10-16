/** Imports are symlinks; config changes preserve backend settings and unrelated entries. */
import { PATHS } from './device.js';
import { fileName, checkedModelFile, q } from './validation.js';
export async function linkModel(device, name, file, signal) {
  fileName(name);
  checkedModelFile('litert', file);
  const dir = `${PATHS.litertHome}/models/${name}`;
  await device.shell(`mkdir -p ${q(dir)} && ln -sf ${q(file)} ${q(`${dir}/model.litertlm`)}`, signal);
}
export async function setLitertConfig(device, name, patch, signal) {
  fileName(name);
  const path = `${PATHS.litertHome}/config.json`;
  const raw = await device.shell(`if [ -f ${q(path)} ]; then cat ${q(path)}; else printf '{}'; fi`, signal);
  const config = JSON.parse(raw);
  config.models ??= {};
  if (patch === null) delete config.models[name];
  else config.models[name] = { ...config.models[name], ...patch };
  const b64 = Buffer.from(JSON.stringify(config, null, 2)).toString('base64');
  await device.shell(`mkdir -p ${q(PATHS.litertHome)} && printf %s ${q(b64)} | base64 -d > ${q(`${path}.tmp`)} && mv ${q(`${path}.tmp`)} ${q(path)}`, signal);
}
export async function unlinkModel(device, name, signal) {
  fileName(name);
  await device.shell(`rm -f ${q(`${PATHS.litertHome}/models/${name}/model.litertlm`)}; rmdir ${q(`${PATHS.litertHome}/models/${name}`)}`, signal);
  await setLitertConfig(device, name, null, signal);
}
