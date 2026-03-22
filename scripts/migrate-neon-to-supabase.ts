import { Pool } from "pg";

const OLD_NEON =
  "postgresql://neondb_owner:npg_qVYM2DQ6ClOU@ep-wandering-darkness-aby2800s-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const NEW_SUPABASE = process.env.NEON_DATABASE_URL!;

const tables = [
  "users",
  "settings",
  "oauth_states",
  "slots",
  "coupons",
  "payments",
  "preorders",
  "bids",
];

function serializeVal(v: any): any {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

async function migrate() {
  const neon = new Pool({ connectionString: OLD_NEON });
  const supa = new Pool({ connectionString: NEW_SUPABASE });

  for (const table of tables) {
    try {
      const res = await neon.query(`SELECT * FROM public.${table}`);
      if (res.rows.length === 0) {
        console.log(`${table}: 0 rows (skipped)`);
        continue;
      }
      let inserted = 0;
      let skipped = 0;
      for (const row of res.rows) {
        const cols = Object.keys(row);
        const vals = Object.values(row).map(serializeVal);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
        try {
          await supa.query(
            `INSERT INTO public.${table} (${cols.join(", ")}) OVERRIDING SYSTEM VALUE VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            vals
          );
          inserted++;
        } catch (e: any) {
          if (e.message.includes("non-DEFAULT") || e.message.includes("OVERRIDING")) {
            try {
              await supa.query(
                `INSERT INTO public.${table} (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
                vals
              );
              inserted++;
            } catch (e2: any) {
              skipped++;
              if (skipped <= 2) console.log(`  Row error in ${table}: ${e2.message}`);
            }
          } else {
            skipped++;
            if (skipped <= 2) console.log(`  Row error in ${table}: ${e.message}`);
          }
        }
      }
      console.log(`${table}: ${inserted}/${res.rows.length} rows migrated (${skipped} skipped)`);
    } catch (e: any) {
      console.log(`${table}: ERROR - ${e.message}`);
    }
  }

  await neon.end();
  await supa.end();
  console.log("\nMigration complete!");
}

migrate();
