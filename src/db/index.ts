import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Next dev reloads modules on every edit; without caching on globalThis each
// reload would open a new pool and exhaust Postgres connections.
const globalForDb = globalThis as unknown as {
  sqlClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.sqlClient ?? postgres(env.databaseUrl, { max: 10 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
