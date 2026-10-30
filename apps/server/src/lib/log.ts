import type { MiddlewareHandler } from "hono";

/**
 * Request log without query strings or bodies: search terms and form fields
 * can carry emails and phones, which must not reach logs.
 */
export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  console.log(
    JSON.stringify({
      msg: "request",
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      ms: Date.now() - start,
    }),
  );
};

export function logError(err: unknown, context: Record<string, unknown> = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  // Message and stack only; never the request body or row data.
  console.error(JSON.stringify({ msg: "error", error: e.name, message: e.message, stack: e.stack, ...context }));
}
