import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export class Store {
  private db: DatabaseSync;
  constructor(path: string, readonly namespace: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (
        namespace TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
        data TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(namespace,kind,key)
      );`);
  }
  get<T>(kind: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM records WHERE namespace=? AND kind=? AND key=?')
      .get(this.namespace, kind, key) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }
  put<T>(kind: string, key: string, data: T): T {
    // First committed observation wins, including across processes/restarts.
    this.db.prepare('INSERT OR IGNORE INTO records VALUES (?,?,?,?,?)')
      .run(this.namespace, kind, key, JSON.stringify(data), Date.now());
    return this.get<T>(kind, key)!;
  }
  stats(): Record<string, number> {
    const rows = this.db.prepare('SELECT kind, COUNT(*) AS n FROM records WHERE namespace=? GROUP BY kind')
      .all(this.namespace) as { kind: string; n: number }[];
    return Object.fromEntries(rows.map(r => [r.kind, r.n]));
  }
  close() { this.db.close(); }
}
export function key(s: string) { return createHash('sha256').update(s).digest('hex'); }
