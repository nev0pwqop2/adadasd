import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString =
  process.env.NEON_DATABASE_URL ||
  "postgresql://postgres:barneyisadinosau@db.rwflvsslkcpubiyveykk.supabase.co:5432/postgres";


export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
