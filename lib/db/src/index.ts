import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = "postgresql://postgres.rwflvsslkcpubiyveykk:barneyisadinosau@aws-1-us-east-1.pooler.supabase.com:5432/postgres";


export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
