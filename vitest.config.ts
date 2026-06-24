import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: false,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        // Side-effect-only auto-install entrypoint — exercised end-to-end by the
        // browser-style integration in install.test.ts; line coverage of the
        // .then/.catch wrappers adds no signal.
        "src/auto.ts",
        // Pure type declarations, no runtime code.
        "src/types.ts",
        "src/**/*.d.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
