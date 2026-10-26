type Level = "info" | "warn" | "error";

// One JSON object per line so Railway's log search can filter on fields.
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export function errorFields(error: unknown) {
  return error instanceof Error
    ? { error: error.message, stack: error.stack }
    : { error: String(error) };
}
