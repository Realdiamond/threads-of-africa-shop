import { purgeStrayUploads } from "./admin/media.server";
import { purgeExpiredSessions } from "./auth/admin-auth.server";
import { purgeExpiredCarts } from "./cart.server";
import { processEmailOutbox, purgeOldEmails } from "./email/processor.server";
import { errorFields, log } from "./log.server";
import { expireStaleOrders } from "./orders.server";

// Background work that runs inside the web process: one Railway service is enough, with no
// separate worker to deploy. Each job is guarded against overlapping with itself.
const OUTBOX_EVERY_MS = 15_000;
const ORDER_EXPIRY_EVERY_MS = 60_000;
const MAINTENANCE_EVERY_MS = 60 * 60 * 1000;

// If a job has been "running" far longer than any run should take (a database connection that
// silently went away, say), it is presumed stuck and the next tick starts it again. Every job is
// safe to overlap with itself, so this can only help.
const STALL_AFTER_MS = 5 * 60 * 1000;
const running = new Map<string, number>();

async function once(name: string, run: () => Promise<void>) {
  const startedAt = running.get(name);
  if (startedAt !== undefined) {
    if (Date.now() - startedAt < STALL_AFTER_MS) return;
    log("error", `background job "${name}" has been running for over 5 minutes; starting it again`);
  }
  const mine = Date.now();
  running.set(name, mine);
  try {
    await run();
  } catch (error) {
    log("error", `background job "${name}" failed`, errorFields(error));
  } finally {
    // Only clear our own mark, not that of a newer run that replaced a stuck one.
    if (running.get(name) === mine) running.delete(name);
  }
}

export async function runMaintenance() {
  const [carts, sessions, uploads, emails] = await Promise.all([
    purgeExpiredCarts(),
    purgeExpiredSessions().then(() => 0),
    purgeStrayUploads(),
    purgeOldEmails(),
  ]);
  if (carts + uploads + emails > 0) {
    log("info", "maintenance finished", {
      expiredCarts: carts,
      strayUploads: uploads,
      oldEmails: emails,
      sessions,
    });
  }
}

const globals = globalThis as { __toaJobsStarted?: boolean };

export function startBackgroundJobs() {
  if (globals.__toaJobsStarted) return;
  if (process.env["DISABLE_JOBS"] === "true" || process.env["VITEST"]) return;
  globals.__toaJobsStarted = true;

  const outbox = setInterval(
    () => void once("email-outbox", async () => void (await processEmailOutbox())),
    OUTBOX_EVERY_MS,
  );
  const orderExpiry = setInterval(
    () => void once("order-expiry", async () => void (await expireStaleOrders())),
    ORDER_EXPIRY_EVERY_MS,
  );
  const maintenance = setInterval(
    () => void once("maintenance", runMaintenance),
    MAINTENANCE_EVERY_MS,
  );
  const first = setTimeout(() => void once("maintenance", runMaintenance), 60_000);
  // Never keep the process alive just for these.
  outbox.unref();
  orderExpiry.unref();
  maintenance.unref();
  first.unref();
  log("info", "background jobs started");
}
