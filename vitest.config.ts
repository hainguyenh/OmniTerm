import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/testSetup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "plugins/**/*.test.ts",
      "src-tauri/sidecar/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist", "plugins/markdown-explorer"],
    coverage: {
      provider: "v8",
      include: [
        "src/**/*.{ts,tsx}",
        "contract/**/*.ts",
        "plugins/*/src/**/*.ts",
        "src-tauri/sidecar/**/*.cjs",
      ],
      exclude: [
        "**/*.d.ts",
        "**/__tests__/**",
        "**/*.{test,spec}.{ts,tsx,js,cjs}",
        "src/main.tsx",
        "src/testSetup.ts",
        "src/testUtils.tsx",
        "src/assets/**",
        "src/generated/**",
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
