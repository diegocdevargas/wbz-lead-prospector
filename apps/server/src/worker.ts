import { createNeonDb } from "@wbz/db/neon";
import { createApp } from "./app.tsx";
import { loadSettings } from "./lib/env.ts";

type Bindings = Record<string, unknown>;

// Env is identical for every request in an isolate, so the app is built once.
let app: ReturnType<typeof createApp> | null = null;

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    if (!app) {
      const settings = loadSettings(env);
      // A Neon WebSocket pool cannot be shared across requests on Workers: one per request, closed after.
      app = createApp(settings, async () => {
        const { db, close } = createNeonDb(settings.env.DATABASE_URL);
        return { db, settings, release: close };
      });
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
