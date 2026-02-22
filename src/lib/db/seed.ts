import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "./schema";
import { eq } from "drizzle-orm";

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

async function seed() {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client);

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, DEFAULT_USER_ID));

  if (existing.length === 0) {
    await db.insert(users).values({
      id: DEFAULT_USER_ID,
      name: "Default User",
    });
    console.log("Seeded default user");
  } else {
    console.log("Default user already exists");
  }

  await client.end();
}

seed().catch(console.error);
