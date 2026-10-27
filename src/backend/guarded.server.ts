import { errorFields, log } from "./log.server";

// Unexpected failures are logged in full but only a generic message reaches the browser.
export async function guarded<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    log("error", `${name} failed`, errorFields(error));
    throw new Error("Something went wrong. Please try again.");
  }
}
