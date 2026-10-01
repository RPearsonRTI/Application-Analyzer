// Browser-only build (GitHub Pages): runs the Python engine in this Web Worker through Pyodide, so the page needs
// no server. tools/build_pages.py puts the engine sources in py/engine.zip next to this file. The worker answers
// {id, path, body} messages with {id, status, body}, the same JSON api/main.py would return (api/handlers.py).
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
importScripts(PYODIDE_URL + "pyodide.js");

const ready = (async () => {
  const progress = (text) => postMessage({ progress: text });
  progress("Loading Python…");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  progress("Loading numerical libraries (largest download, cached afterwards)…");
  await pyodide.loadPackage(["numpy", "scipy", "pydantic", "pyyaml"]);
  progress("Loading the RTI engine…");
  const res = await fetch("py/engine.zip", { cache: "no-cache" });
  if (!res.ok) throw new Error(`engine.zip: HTTP ${res.status}`);
  pyodide.unpackArchive(await res.arrayBuffer(), "zip", { extractDir: "/engine" });
  pyodide.runPython(`
import sys
sys.path[:0] = ["/engine/src", "/engine"]
from api.handlers import dispatch
`);
  return pyodide.globals.get("dispatch");
})();

ready.then(() => postMessage({ ready: true }), (err) => postMessage({ failed: String(err) }));

onmessage = async (ev) => {
  const { id, path, body } = ev.data;
  try {
    const dispatch = await ready;
    const out = JSON.parse(dispatch(path, body ?? null));
    postMessage({ id, status: out.status, body: out.body });
  } catch (err) {
    postMessage({ id, status: 500, body: { detail: String(err) } });
  }
};
