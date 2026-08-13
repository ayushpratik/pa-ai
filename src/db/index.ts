import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Next dev reloads modules on every edit; without caching on globalThis each
// reload would open a new pool and exhaust Postgres connections.
const globalForDb = globalThis as unknown as {
  sqlClient?: ReturnType<typeof postgres>;
};

let instance: PostgresJsDatabase<typeof schema> | undefined;

// Connecting at module load would read DATABASE_URL during `next build`, whose
// page-data collection imports every route. The container image is built
// without any environment, so the pool is opened on first use instead, the same
// way lib/model.ts defers constructing the Gemini provider.
function getDb(): PostgresJsDatabase<typeof schema> {
  if (!instance) {
    const client = globalForDb.sqlClient ?? postgres(env.databaseUrl, { max: 10 });
    if (process.env.NODE_ENV !== "production") {
      globalForDb.sqlClient = client;
    }
    instance = drizzle(client, { schema });
  }
  return instance;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, property) {
    const real = getDb();
    const value = Reflect.get(real, property);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
