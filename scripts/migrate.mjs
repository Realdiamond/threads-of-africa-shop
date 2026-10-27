// Applies db/migrations to DATABASE_URL. Runs before the server starts (see `start` in package.json).
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: fall through to the explicit error below.
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });
  console.log("migrations applied");
} catch (error) {
  console.error("migration failed", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
