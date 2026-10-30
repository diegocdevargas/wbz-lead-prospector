import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createNodeDb } from "@wbz/db/node";
import { createApp } from "./app.tsx";
import { loadSettings } from "./lib/env.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const settings = loadSettings(process.env);
const { db, close } = createNodeDb(settings.env.DATABASE_URL);
const app = createApp(settings, async () => ({ db, settings }));

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
  console.log(`Webcraftz Prospector on http://${info.address}:${info.port} (auth: ${settings.env.AUTH_MODE})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void close().then(() => process.exit(0));
  });
}
