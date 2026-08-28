import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = path.resolve("prisma/dev.sqlite");
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON;");

const migrationRoot = path.resolve("prisma/migrations");
for (const name of fs.readdirSync(migrationRoot).sort()) {
  const sqlPath = path.join(migrationRoot, name, "migration.sql");
  if (!fs.existsSync(sqlPath)) continue;
  const marker = `__migration_${name}`;
  database.exec('CREATE TABLE IF NOT EXISTS "_local_migrations" ("name" TEXT PRIMARY KEY);');
  const applied = database.prepare('SELECT 1 FROM "_local_migrations" WHERE "name" = ?').get(marker);
  if (applied) continue;
  database.exec("BEGIN");
  try {
    database.exec(fs.readFileSync(sqlPath, "utf8"));
    database.prepare('INSERT INTO "_local_migrations" ("name") VALUES (?)').run(marker);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
database.close();
console.log(`Local database ready at ${databasePath}`);
