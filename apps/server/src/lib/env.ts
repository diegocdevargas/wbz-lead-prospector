import { type AppConfig, loadAppConfig } from "@wbz/core";
import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    /** Keys the suppression hashes. Rotating it orphans existing opt-outs, so treat it as permanent. */
    SUPPRESSION_SECRET: z.string().min(32, "SUPPRESSION_SECRET must be at least 32 characters"),
    ENVIRONMENT: z.enum(["development", "test", "production"]).default("production"),
    AUTH_MODE: z.enum(["access", "basic", "none"]).default("access"),
    BASIC_AUTH_USER: z.string().optional(),
    BASIC_AUTH_PASSWORD: z.string().min(12, "BASIC_AUTH_PASSWORD must be at least 12 characters").optional(),
    /** e.g. "webcraftz.cloudflareaccess.com" */
    CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
    CF_ACCESS_AUD: z.string().optional(),
    APP_CONFIG: z.string().optional(),
    /** One key restricted to Places API (New) + PageSpeed Insights. Without it, discovery and PageSpeed are off. */
    GOOGLE_API_KEY: z.string().min(20, "GOOGLE_API_KEY looks too short").optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === "none" && env.ENVIRONMENT === "production") {
      ctx.addIssue({ code: "custom", message: "AUTH_MODE=none is not allowed in production" });
    }
    if (env.AUTH_MODE === "basic" && !(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASSWORD)) {
      ctx.addIssue({ code: "custom", message: "AUTH_MODE=basic needs BASIC_AUTH_USER and BASIC_AUTH_PASSWORD" });
    }
    if (env.AUTH_MODE === "access" && !(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD)) {
      ctx.addIssue({ code: "custom", message: "AUTH_MODE=access needs CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD" });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface Settings {
  env: Env;
  config: AppConfig;
}

/** Validate env once; a misconfigured deploy fails loudly instead of running half-secured. */
export function loadSettings(source: Record<string, unknown>): Settings {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return { env: parsed.data, config: loadAppConfig(parsed.data.APP_CONFIG) };
}
