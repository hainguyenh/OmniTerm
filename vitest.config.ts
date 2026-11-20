import { defineConfig } from "vitest/config";

import { ideAliases } from "./scripts/ide-aliases.mjs";

export default defineConfig({
  resolve: { alias: ideAliases },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    // Keep Windows fork startup reliable on developer machines and CI runners with many logical
    // cores. The default creates one worker per core, which can time out before a test starts when
    // several jsdom workers initialize simultaneously.
    maxWorkers: 8,
    setupFiles: ["./ui/testSetup.ts"],
    include: ["ui/**/*.test.ts", "ui/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      include: ["ui/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "**/__tests__/**",
        "**/*.{test,spec}.{ts,tsx,js,cjs}",
        "ui/main.tsx",
        "ui/testSetup.ts",
        "ui/testUtils.tsx",
        // The IDE modules keep their own code style and are outside the JS coverage gate.
        "ui/ide/**",
        "ui/assets/**",
        "ui/generated/**",
      ],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage-js",
      reportOnFailure: true,
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 85,
      },
    },
  },
});
