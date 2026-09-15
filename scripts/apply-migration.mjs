// Apply ONE migration file (not the whole chain — 0012 drops fog_doors on
// every run). Usage: DATABASE_URL='<pooler url>' node scripts/apply-migration.mjs 0014_room_cast_token.sql
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const file = process.argv[2];
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error(
    "Usage: DATABASE_URL='<pooler url>' node scripts/apply-migration.mjs <file.sql>",
  );
  process.exit(1);
}

const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  process.stdout.write(`applying ${file} … `);
  await client.query(sql);
  console.log("ok");
} finally {
  await client.end();
}
