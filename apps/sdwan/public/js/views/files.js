import { h, download, copyText } from '../dom.js';
import { store } from '../store.js';

let tab = 'project';
export function filesView(io) {
  const f = store.files();
  const design = JSON.stringify({ format: 'sdwan-advpn-designer', version: 1, name: store.name, model: store.model }, null, 2);
  const tabs = { project: ['Project.j2', f.project], inventory: ['inventory.json', f.inventory], design: ['design.json', design] };
  const [fname, text] = tabs[tab];
  const rel = store.model.release;
  return h('div', { class: 'view' }, h('div', { class: 'viewhead' }, h('h2', {}, 'Files'),
    h('p', {}, 'Everything the designer produces is plain Jinja Orchestrator input, so you can render offline or use it in FortiManager exactly as Fortinet documents.')),
    h('div', { class: 'cols2' },
      h('section', { class: 'card' }, h('div', { class: 'tabs' }, Object.entries(tabs).map(([k, [n]]) => h('button', { class: 'tab' + (k === tab ? ' on' : ''), onclick: () => { tab = k; store.change(() => {}); } }, n))),
        h('div', { class: 'btnrow pad' },
          h('button', { class: 'btn', onclick: async e => { const ok = await copyText(text); e.target.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => (e.target.textContent = 'Copy'), 1400); } }, 'Copy'),
          h('button', { class: 'btn', onclick: () => download(fname, text) }, 'Download ' + fname)),
        h('pre', { class: 'filetext' }, text)),
      h('div', {},
        h('section', { class: 'card' }, h('h3', {}, 'Import'),
          h('p', { class: 'blurb' }, 'Load an existing design. Choose a Project Template (.j2), an inventory (.json), both at once, or a design.json exported from here. Comments in a .j2 are not preserved.'),
          h('div', { class: 'drop', tabindex: '0', ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: e => e.currentTarget.classList.remove('over'),
            ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('over'); io.importFiles(e.dataTransfer.files); } },
            h('p', {}, 'Drop files here or ', h('label', { class: 'btn' }, 'choose files', h('input', { type: 'file', multiple: true, hidden: true, onchange: e => io.importFiles(e.target.files) })))),
          h('div', { class: 'btnrow pad' }, h('span', { class: 'hint' }, 'Examples from Fortinet:'),
            io.examples.map(([label, p, i]) => h('button', { class: 'ghost', onclick: () => io.loadExample(p, i, label) }, label)))),
        h('section', { class: 'card' }, h('h3', {}, 'Render offline with Fortinet’s CLI'),
          h('p', { class: 'blurb' }, 'Same output as this page, using Fortinet’s Python renderer from the ', h('code', {}, 'release/' + rel), ' branch:'),
          h('pre', { class: 'cmd' }, 'pip3 install jinja2 ansible netaddr\n./render_config.py -f dynamic-bgp-on-lo \\\n  -p Project.j2 -i inventory.json'),
          h('p', { class: 'blurb' }, 'Or paste the Project Template into a FortiManager Jinja template group (FMG 7.0.1+) with the Orchestrator templates; see Fortinet’s deployment guide.')))));
}
