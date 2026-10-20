import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

/** Opens (or creates) the SQLite database and brings its schema up to date. */
export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);
  return db;
}

/** Runs fn inside a transaction, rolling back if it throws. */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Applies migrations/NNN_name.sql files in order. The schema version is kept
 * in SQLite's built-in user_version, so each file runs exactly once.
 */
export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  for (const name of files) {
    const version = Number.parseInt(name, 10);
    if (version <= current) continue;
    const sql = readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
    });
  }
}
