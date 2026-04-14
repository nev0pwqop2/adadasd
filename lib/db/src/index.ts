import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL environment variable is not set");


export const pool = new Pool({ connectionString, max: 5 });
export const db = drizzle(pool, { schema });

export * from "./schema";
