// The router turns every address-bar value that looks like JSON into a number or boolean
// (?placed=1 arrives as the number 1, ?search=1001 as 1001). Routes use this to read such a value
// back as the text that was typed.
export function searchText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

// A yes/no flag in a web address (?placed=1, ?placed=true). Written back out as ?placed=true.
export const searchFlag = (value: unknown): true | undefined =>
  value === true || value === 1 || value === "1" || value === "true" ? true : undefined;

// Where to go after signing in. Only addresses on this site are followed, never another website.
export const safeNext = (value: string | undefined): string =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
