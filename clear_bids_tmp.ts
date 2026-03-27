import { db } from "./lib/db/src/index.ts";
import { sql } from "drizzle-orm";
const result = await db.execute(sql`DELETE FROM bids`);
console.log("Done, rows deleted:", result.rowCount);
process.exit(0);
