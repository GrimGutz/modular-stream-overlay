/**
 * Saved versions of overlays and widget designs, kept in this browser's IndexedDB. Every save
 * adds one; the oldest beyond the limit are dropped. Versions never sync to other clients or
 * OBS: a world setting holding them would be resent to every client on each save.
 */
export const VERSION_LIMIT = 30;
const DATABASE = "modular-stream-overlay";
const STORE = "versions";

const request = operation => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});

export class VersionStore {
  constructor({ indexedDB = globalThis.indexedDB, limit = VERSION_LIMIT, now = () => Date.now() } = {}) {
    this.indexedDB = indexedDB;
    this.limit = limit;
    this.now = now;
    // Without IndexedDB (tests, locked-down browsers) versions last for this session only.
    this.memory = indexedDB ? null : [];
    this.nextId = 1;
  }

  database() {
    this.opening ??= new Promise((resolve, reject) => {
      const open = this.indexedDB.open(DATABASE, 1);
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("key", "key");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.opening;
  }

  async transaction(mode, work) {
    const database = await this.database();
    const transaction = database.transaction(STORE, mode);
    const result = await work(transaction.objectStore(STORE));
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    return result;
  }

  /** Versions of one document, newest first. */
  async list(key) {
    if (this.memory) return this.memory.filter(entry => entry.key === key).sort((a, b) => b.savedAt - a.savedAt || b.id - a.id).map(entry => structuredClone(entry));
    const entries = await this.transaction("readonly", store => request(store.index("key").getAll(key)));
    return entries.sort((a, b) => b.savedAt - a.savedAt || b.id - a.id);
  }

  /** Record a saved document unless it equals the newest version. Returns whether it was added. */
  async add(key, document) {
    const snapshot = JSON.stringify(document);
    const [latest] = await this.list(key);
    if (latest && JSON.stringify(latest.document) === snapshot) return false;
    const entry = { key, savedAt: this.now(), document: JSON.parse(snapshot) };
    if (this.memory) this.memory.push({ ...entry, id: this.nextId++ });
    else await this.transaction("readwrite", store => request(store.add(entry)));
    const stale = (await this.list(key)).slice(this.limit);
    if (!stale.length) return true;
    if (this.memory) this.memory = this.memory.filter(item => !stale.some(old => old.id === item.id));
    else await this.transaction("readwrite", store => Promise.all(stale.map(old => request(store.delete(old.id)))));
    return true;
  }
}
