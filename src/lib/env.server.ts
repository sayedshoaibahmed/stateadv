import "server-only";
import { z } from "zod";
import { formatEnvError } from "./env";

/**
 * Server-only environment variables. Importing this file from a Client
 * Component fails the build (`server-only`), so secrets cannot leak.
 */
const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  CRON_SECRET: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  APP_TIMEZONE: z.literal("Asia/Kolkata").default("Asia/Kolkata"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const result = serverEnvSchema.safeParse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    APP_TIMEZONE: process.env.APP_TIMEZONE || undefined,
  });
  if (!result.success) throw new Error(formatEnvError(result.error));
  cached = result.data;
  return cached;
}
