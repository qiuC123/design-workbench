import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// The online backup API includes committed WAL data without stopping the local website.
const source = resolve(process.argv[2] || '.data/workbench.sqlite');
const destination = resolve('.data/deployment-backups', new Date().toISOString().replaceAll(':', '-'));
await mkdir(destination, { recursive: true });
const original = new DatabaseSync(source, { readOnly: true });
const snapshot = join(destination, 'workbench.sqlite');
try { await backup(original, snapshot); } finally { original.close(); }
const cloudCopy = join(destination, 'cloud-import.sqlite');
await copyFile(snapshot, cloudCopy);
const db = new DatabaseSync(cloudCopy);
let manifest;
try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') throw new Error(`Backup integrity failed: ${integrity}`);
  // Retain account and projects; a moved deployment requires a fresh sign-in.
  db.exec('DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');
  const row = db.prepare('SELECT state, revision FROM workspace WHERE id=1').get();
  manifest = { createdAt: new Date().toISOString(), source, snapshot, cloudCopy, integrity,
    revision: row.revision, projects: JSON.parse(row.state).projects.length,
    admins: db.prepare('SELECT count(*) AS count FROM admin').get().count,
    sessions: db.prepare('SELECT count(*) AS count FROM sessions').get().count };
} finally { db.close(); }
manifest.sha256 = createHash('sha256').update(await readFile(cloudCopy)).digest('hex');
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
