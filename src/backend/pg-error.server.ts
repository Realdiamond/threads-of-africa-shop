export type PgErrorInfo = { code?: string | undefined; constraint?: string | undefined };

// Drizzle wraps driver errors, so the Postgres details can be one or two levels down.
export function pgError(error: unknown): PgErrorInfo {
  const e = error as { code?: unknown; constraint?: unknown; cause?: unknown } | null;
  if (e && typeof e.code === "string") {
    return {
      code: e.code,
      constraint: typeof e.constraint === "string" ? e.constraint : undefined,
    };
  }
  return e?.cause ? pgError(e.cause) : {};
}

export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";
export const CHECK_VIOLATION = "23514";
