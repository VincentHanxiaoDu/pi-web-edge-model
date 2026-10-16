/** Owns metadata only; files and running engines are always observed on the device. */
export function createStore(storage) {
  let tail = Promise.resolve();
  const read = async (key) => (await storage.read(key)) ?? {};
  const update = (key, fn) => {
    const next = tail.then(async () => {
      const value = fn(await read(key));
      await storage.write(key, value);
      return value;
    });
    tail = next.catch(() => {});
    return next;
  };
  return {
    models: () => read('models'),
    state: () => read('state'),
    patch: (id, patch) => update('models', (all) => ({ ...all, [id]: { ...all[id], ...patch } })),
    forget: (id) => update('models', (all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id))),
    patchState: (patch) => update('state', (state) => ({ ...state, ...patch })),
  };
}
