import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations complete!");

// Seed default user
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
await sql`
  INSERT INTO users (id, name)
  VALUES (${DEFAULT_USER_ID}, 'Default User')
  ON CONFLICT (id) DO NOTHING
`;
console.log("Default user seeded.");

await sql.end();
