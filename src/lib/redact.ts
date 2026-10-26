// A failed database query is reported by the ORM as "Failed query: <sql>\nparams: <every value>".
// Those values can be customer details, order links or bag ids, and logs are read by more people
// than the database is, so the values are cut out; the SQL text (with $1, $2 placeholders) stays.
export function redactQueryParams(text: string): string {
  return text.replace(/\nparams:[\s\S]*?(?=\n {4}at |\ncaused by: |$)/g, "\nparams: [hidden]");
}
