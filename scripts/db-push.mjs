// Applies only pending supabase/migrations/*.sql files in filename order.
// Applied filenames are tracked in public.schema_migrations.
//
// Usage:
//   DATABASE_URL='postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres' npm run db:push
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
  // Prevent two DB Push jobs from applying migrations at the same time.
  await client.query("select pg_advisory_lock(hashtext('malvidra-encounter-db-push'))");

  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await client.query(
    "select filename from public.schema_migrations order by filename"
  );
  const applied = new Set(rows.map((row) => row.filename));
  const pending = files.filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log("Database is up to date — no pending migrations.");
    process.exitCode = 0;
  } else {
    console.log(`Pending migrations: ${pending.length}`);

    for (const file of pending) {
      const sql = readFileSync(join(dir, file), "utf8");

      process.stdout.write(`applying ${file} … `);
      await client.query("begin");

      try {
        await client.query(sql);
        await client.query(
          "insert into public.schema_migrations (filename) values ($1)",
          [file]
        );
        await client.query("commit");
        console.log("ok");
      } catch (error) {
        await client.query("rollback");
        console.log("failed");
        throw error;
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  }
} finally {
  try {
    await client.query("select pg_advisory_unlock(hashtext('malvidra-encounter-db-push'))");
  } catch {
    // Connection cleanup below is still the priority if unlock itself fails.
  }
  await client.end();
}
