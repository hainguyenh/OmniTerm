import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    // Keep Windows fork startup reliable on developer machines and CI runners with many logical
    // cores. The default creates one worker per core, which can time out before a test starts when
    // several jsdom workers initialize simultaneously.
    maxWorkers: 8,
    setupFiles: ["./ui/testSetup.ts"],
    include: [
      "ui/**/*.test.ts",
      "ui/**/*.test.tsx",
      "plugins/**/*.test.ts",
      "plugins/**/*.test.tsx",
      "src-tauri/sidecar/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist", "plugins/markdown-explorer"],
    coverage: {
      provider: "v8",
      include: [
        "ui/**/*.{ts,tsx}",
        "contract/**/*.ts",
        "plugins/*/src/**/*.ts",
        "plugins/*/app/**/*.{ts,tsx}",
        "src-tauri/sidecar/**/*.cjs",
      ],
      exclude: [
        "**/*.d.ts",
        "**/__tests__/**",
        "**/*.{test,spec}.{ts,tsx,js,cjs}",
        "ui/main.tsx",
        "ui/testSetup.ts",
        "ui/testUtils.tsx",
        "ui/assets/**",
        "ui/generated/**",
        "src-tauri/sidecar/plugin-host.cjs",
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
