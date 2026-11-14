import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    environment: "node",
    // Each database test file builds its own PGlite database from every migration in its setup hook. With 70 files running
    // side by side that can take longer than the default 10 seconds on a busy computer; this only lets the setup finish.
    hookTimeout: 120_000,
    // Run with a non-IST machine time zone to prove IST handling does not
    // depend on the developer's computer settings.
    env: { TZ: "America/New_York" },
  },
});
