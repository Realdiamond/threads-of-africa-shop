// The shop's public address, used in links inside emails. Set SITE_URL in production
// (for example https://thethreadsofafrica.com); on Railway it falls back to the service's own domain.
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["SITE_URL"]?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railway = env["RAILWAY_PUBLIC_DOMAIN"]?.trim();
  if (railway) return `https://${railway}`;
  return "http://localhost:8080";
}
