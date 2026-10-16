import type { MiddlewareHandler } from "hono";
import { basicAuth } from "hono/basic-auth";
import { jwk } from "hono/jwk";
import type { Env } from "./env.ts";

/**
 * Fail-closed auth for everything except /healthz.
 * - access: verify the Cloudflare Access JWT (signature, issuer, audience), so
 *   requests that bypass Access (e.g. the workers.dev URL) are rejected too.
 * - basic: HTTP basic auth, meant for local or staging use.
 * - none: development only (enforced in env validation).
 */
export function authMiddleware(env: Env): MiddlewareHandler {
  if (env.AUTH_MODE === "none") return async (_c, next) => next();
  if (env.AUTH_MODE === "basic") {
    return basicAuth({
      username: env.BASIC_AUTH_USER as string,
      password: env.BASIC_AUTH_PASSWORD as string,
      realm: "Webcraftz Prospector",
    });
  }
  const team = env.CF_ACCESS_TEAM_DOMAIN as string;
  return jwk({
    jwks_uri: `https://${team}/cdn-cgi/access/certs`,
    headerName: "Cf-Access-Jwt-Assertion",
    alg: ["RS256"],
    verification: { iss: `https://${team}`, aud: env.CF_ACCESS_AUD as string },
  });
}
