/** Human-facing labels are separate from filenames, provider ids and device paths. */
export function title(model) {
  const n = model.name.toLowerCase();
  if (/qwen3.*4b/.test(n)) return 'Qwen3 · 4B';
  if (/gemma-?4.*e2b|gemma-4-e2b/.test(n)) return 'Gemma 4 · E2B';
  if (/gemma-?3.*4b/.test(n)) return 'Gemma 3 · 4B';
  if (/gemma-?3.*1b/.test(n)) return 'Gemma 3 · 1B';
  return model.name.replace(/[_-]/g, ' ');
}
export function variant(model) {
  return /abliterated|uncensored|heretic|(?:^|[-_.])abl(?:[-_.]|$)/i.test(model.name) ? '去审查版' : '原版';
}
export function engine(model) {
  return `${model.engine === 'llamacpp' ? 'llama.cpp' : 'LiteRT'} · ${model.backend.toUpperCase()}`;
}
export function context(tokens) { return tokens % 1024 === 0 ? `${tokens / 1024}K` : String(tokens); }
export function rank(model) {
  if (model.note) return 9;
  if (model.engine === 'llamacpp' && /qwen/i.test(model.name)) return 0;
  return model.inPi ? 1 : 2;
}
