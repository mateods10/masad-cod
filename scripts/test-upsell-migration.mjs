import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const db = new DatabaseSync(':memory:');
try {
  for (const name of readdirSync('prisma/migrations').sort()) {
    const file = join('prisma/migrations', name, 'migration.sql');
    if (existsSync(file)) db.exec(readFileSync(file, 'utf8'));
  }
  assert(db.prepare('PRAGMA table_info("CartSession")').all().some(c => c.name === 'upsellEditing'));
  const insert = db.prepare('INSERT INTO "UpsellAcceptance" (id,shop,orderId,campaignId,offerId,updatedAt) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)');
  insert.run('one', 'shop', 'order', 'campaign', 'offer');
  assert.throws(() => insert.run('two', 'shop', 'order', 'campaign', 'offer'), /UNIQUE/);
  insert.run('three', 'another-shop', 'order', 'campaign', 'offer');
  console.log('All migration SQL applied; acceptance uniqueness and store isolation passed.');
} finally { db.close(); }
