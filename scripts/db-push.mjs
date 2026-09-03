// Applies every supabase/migrations/*.sql in order to the database in $DATABASE_URL.
// Usage: DATABASE_URL='postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres' npm run db:push
//
// (The Supabase CLI mis-escapes '!' in pooler passwords, so we use `pg` directly.)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (Supabase pooler connection string).");
  process.exit(1);
}

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  for (const f of files) {
    process.stdout.write(`applying ${f} … `);
    await client.query(readFileSync(join(dir, f), "utf8"));
    console.log("ok");
  }
} finally {
  await client.end();
}
