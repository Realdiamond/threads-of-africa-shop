import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { errorFields, log } from "../log.server";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
// Either the database or an open transaction: lets helpers run inside the caller's transaction.
export type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

let pool: Pool | undefined;
let db: Db | undefined;

function databaseUrl() {
  if (!process.env["DATABASE_URL"] && process.env["NODE_ENV"] !== "production") {
    try {
      process.loadEnvFile(".env");
    } catch {
      // No .env file: fall through to the explicit error below.
    }
  }
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

export function getDb(): Db {
  if (!db) {
    pool = new Pool({
      connectionString: databaseUrl(),
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Lets the process exit as soon as it is told to stop and nothing is running.
      allowExitOnIdle: true,
      statement_timeout: 10_000,
    });
    // An idle client erroring (e.g. Postgres restart) must not crash the process.
    pool.on("error", (error) => log("error", "postgres pool error", errorFields(error)));
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
