// Creates an admin account from the command line: how the very first owner is made.
//   bun run admin:create -- --email owner@example.com --name "Full Name" [--role owner|staff]
// A temporary password is printed once; the person must replace it when they first sign in.
import { eq } from "drizzle-orm";

import { recordAudit } from "../src/backend/admin/audit.server";
import { generatePassword, hashPassword } from "../src/backend/auth/password.server";
import { closeDb, getDb } from "../src/backend/db/client.server";
import { adminUsers } from "../src/backend/db/schema";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const role = arg("role") ?? "owner";

if (!email || !name || (role !== "owner" && role !== "staff")) {
  console.error(
    'Usage: bun run admin:create -- --email someone@example.com --name "Full Name" [--role owner|staff]',
  );
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("That does not look like an email address.");
  process.exit(1);
}

const db = getDb();
try {
  const [existing] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.email, email));
  if (existing) {
    console.error(
      `An account for ${email} already exists. Use "Reset password" on the Team page instead.`,
    );
    process.exitCode = 1;
  } else {
    const temporaryPassword = generatePassword();
    const [user] = await db
      .insert(adminUsers)
      .values({
        email,
        name,
        role,
        status: "invited",
        passwordHash: await hashPassword(temporaryPassword),
      })
      .returning({ id: adminUsers.id });
    await recordAudit(
      db,
      { id: null, email: "command line" },
      "user_created",
      "admin_user",
      user?.id ?? "",
      `Added ${email} as ${role}`,
    );
    console.log(`\nCreated ${role} account for ${name} <${email}>`);
    console.log(`Temporary password (shown once): ${temporaryPassword}`);
    console.log("They will be asked to choose their own password at first sign-in.\n");
  }
} catch (error) {
  console.error("Could not create the account", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
