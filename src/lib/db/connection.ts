import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// No "server-only" import here on purpose — this module is also loaded
// directly by standalone tsx scripts (scripts/seed-dev-db.ts,
// scripts/check-dev-db.ts), which run outside Next.js's bundler and never
// set the "react-server" export condition "server-only" relies on. The
// browser-bundling guard lives in ./client.ts instead, for Next.js app code.

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Define it in .env.local (see .env.example) before using the database client."
  );
}

// Dev-safe singleton: without this, every hot-reload in `next dev` would
// open a fresh postgres.js connection pool and eventually exhaust the
// database's max_connections.
const globalForDb = globalThis as unknown as {
  __dssPgClient?: postgres.Sql;
  __dssDb?: ReturnType<typeof drizzle<typeof schema>>;
};

const queryClient =
  globalForDb.__dssPgClient ??
  postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

export const db = globalForDb.__dssDb ?? drizzle(queryClient, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__dssPgClient = queryClient;
  globalForDb.__dssDb = db;
}
