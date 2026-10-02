// Main-thread client for the Python worker. Renders are "latest wins".
export class Engine {
  constructor(base, onStatus) {
    this.base = base; this.onStatus = onStatus || (() => {});
    this.worker = new Worker(base + 'js/worker.js', { type: 'module' });
    this.pending = new Map(); this.seq = 0; this.renderSeq = 0;
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'status') return this.onStatus(data.message);
      const p = this.pending.get(data.id); if (!p) return;
      this.pending.delete(data.id);
      data.type === 'fail' ? p.reject(new Error(data.error)) : p.resolve(data.result);
    };
    this.worker.onerror = e => this.onStatus('Engine error: ' + e.message);
  }
  send(msg) { const id = ++this.seq; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, ...msg }); }); }
  init(release) { return this.ready = this.send({ type: 'init', base: this.base, release }); }
  async render(project, inventory, skipOptional) {
    await this.ready; const mine = ++this.renderSeq;
    const res = await this.send({ type: 'render', project, inventory, skipOptional });
    return mine === this.renderSeq ? res : null; // stale
  }
  async parse(project) { await this.ready; return this.send({ type: 'parse', project }); }
}
