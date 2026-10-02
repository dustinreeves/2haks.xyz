// Runs Python (Pyodide) + Jinja2 off the main thread.
let py = null, call = null;

const post = (id, type, data) => postMessage({ id, type, ...data });

async function init(base, release) {
  const status = m => postMessage({ type: 'status', message: m });
  if (!py) {
    status('Loading Python runtime…');
    const { loadPyodide } = await import(base + 'vendor/pyodide/pyodide.mjs');
    py = await loadPyodide({ indexURL: base + 'vendor/pyodide/' });
    status('Loading Jinja2…');
    await py.loadPackage(['jinja2', 'markupsafe']);
    for (const f of ['ipaddr.py', 'engine.py']) py.FS.writeFile('/' + f, await (await fetch(base + 'py/' + f)).text());
    py.runPython('import sys, json; sys.path.insert(0, "/"); import engine');
    call = (fn, ...args) => { py.globals.set('_a', args); return JSON.parse(py.runPython('engine.' + fn + '(*_a.to_py())')); };
  }
  status('Loading Fortinet ' + release + ' templates…');
  const rel = base + 'releases/' + release + '/';
  const man = await (await fetch(rel + 'manifest.json')).json();
  const tpls = {};
  await Promise.all([...man.templates, ...man.optional].map(async t => { tpls[t] = await (await fetch(rel + 'templates/' + t)).text(); }));
  py.globals.set('_tj', JSON.stringify(tpls));
  py.runPython('engine.load_release(_tj)');
  return man;
}

onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') post(id, 'done', { result: await init(data.base, data.release) });
    else if (type === 'render') {
      const t0 = performance.now();
      const r = call('render', data.project, data.inventory, !!data.skipOptional);
      r.ms = Math.round(performance.now() - t0);
      post(id, 'done', { result: r });
    } else if (type === 'parse') post(id, 'done', { result: call('parse_project', data.project) });
  } catch (e) {
    post(id, 'fail', { error: String(e && e.message || e) });
  }
};
