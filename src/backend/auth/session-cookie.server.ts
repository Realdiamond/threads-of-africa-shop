import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

import { resolveSession, SESSION_ABSOLUTE_SECONDS, type AdminPrincipal } from "./admin-auth.server";

export const SESSION_COOKIE = "toa_admin_session";

// Behind Railway's proxy the app itself sees plain HTTP, so trust the forwarded protocol.
function isHttps() {
  const request = getRequest();
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:";
}

// HttpOnly keeps the token away from page scripts; SameSite=Strict keeps other sites from
// triggering requests with it (the admin has no need to be reachable from a link elsewhere).
export function setSessionCookie(token: string) {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(),
    path: "/",
    maxAge: SESSION_ABSOLUTE_SECONDS,
  });
}

export function clearSessionCookie() {
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

export const readSessionToken = () => getCookie(SESSION_COOKIE);

export async function currentAdmin(): Promise<AdminPrincipal | null> {
  const token = readSessionToken();
  return token ? resolveSession(token) : null;
}
