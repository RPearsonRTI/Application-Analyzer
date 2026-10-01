// Browser-only build (GitHub Pages). Included by tools/build_pages.py only; defines window.rtiBrowserEngine, which
// app.js uses in place of fetch() to the API. The engine itself runs in engine-worker.js.
(() => {
  const worker = new Worker("engine-worker.js");
  const pending = new Map();
  let nextId = 1;
  let onProgress = () => {};
  let settle;
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });

  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.progress) return onProgress(msg.progress);
    if (msg.ready) return settle.resolve();
    if (msg.failed) return settle.reject(new Error(msg.failed));
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (p) p({ status: msg.status, body: msg.body });
  };
  worker.onerror = (ev) => settle.reject(new Error(ev.message || "The calculation engine failed to load."));

  window.rtiBrowserEngine = {
    ready,
    setProgress(fn) { onProgress = fn; },
    // Resolves to {status, body}, like a fetch() response already parsed.
    call(path, payload) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        worker.postMessage({ id, path, body: payload === undefined ? null : JSON.stringify(payload) });
      });
    },
  };
})();
