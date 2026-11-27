// Short-lived retry copies belong only to this tab and count against its budget.
export class DownloadReceipts {
  #entries = []; #timers = new Map(); #onChange; #setTimer; #clearTimer; #ttl;
  constructor({ onChange = () => {}, setTimer = (callback, delay) => globalThis.setTimeout(callback, delay), clearTimer = timer => globalThis.clearTimeout(timer), ttl = 120000 } = {}) {
    this.#onChange = onChange; this.#setTimer = setTimer; this.#clearTimer = clearTimer; this.#ttl = ttl;
  }
  get entries() { return [...this.#entries]; }
  get bytes() { return this.#entries.reduce((sum, entry) => sum + entry.blob.size, 0); }
  add(file) {
    const id = crypto.randomUUID();
    const timer = this.#setTimer(() => this.remove(id), this.#ttl);
    this.#entries.push({ ...file, id });
    this.#timers.set(id, timer);
    this.#onChange(); return id;
  }
  remove(id) {
    this.#clearTimer(this.#timers.get(id)); this.#timers.delete(id);
    this.#entries = this.#entries.filter(entry => entry.id !== id); this.#onChange();
  }
  clear() {
    for (const timer of this.#timers.values()) this.#clearTimer(timer);
    this.#timers.clear(); this.#entries = []; this.#onChange();
  }
}
