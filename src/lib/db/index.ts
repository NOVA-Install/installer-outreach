import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres> | undefined;
};

// Don't throw at module load - Vercel evaluates modules during build
// when DATABASE_URL may not be available
const connectionString = process.env.DATABASE_URL || "";

const client =
  globalForDb.pgClient ??
  (connectionString ? postgres(connectionString, { prepare: false, max: 3 }) : null);

if (client && process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = client;
}

export const db = drizzle(client!, { schema });
