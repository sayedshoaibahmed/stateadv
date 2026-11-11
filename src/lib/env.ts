import { z } from "zod";

/**
 * Public environment variables (safe in the browser).
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js can
 * inline the values into the client bundle.
 *
 * Error messages list variable NAMES only — never values.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20)
    .refine((v) => !v.startsWith("sb_secret_"), {
      message: "a SECRET key was put in a public variable",
    }),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  cached = result.data;
  return cached;
}

export function formatEnvError(error: z.ZodError): string {
  const lines = error.issues.map(
    (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  return `Invalid or missing environment variables (see .env.example):\n${lines.join("\n")}`;
}
