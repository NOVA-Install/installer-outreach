import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres> | undefined;
};

const connectionString = process.env.DATABASE_URL || "";

// Only create the client if DATABASE_URL exists (it won't during Vercel build)
let client: ReturnType<typeof postgres> | null = null;
if (connectionString) {
  client = globalForDb.pgClient ?? postgres(connectionString, { prepare: false, max: 3 });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.pgClient = client;
  }
}

// Lazy proxy — throws a clear error if db is used without DATABASE_URL
// but doesn't crash at module load (which Vercel needs for static analysis)
export const db = client
  ? drizzle(client, { schema })
  : new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
      get(_, prop) {
        if (prop === "then" || prop === Symbol.toPrimitive) return undefined;
        throw new Error(`DATABASE_URL is not set — cannot use db.${String(prop)}`);
      },
    });
