import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./ui/testSetup.ts"],
    include: [
      "ui/**/*.test.ts",
      "ui/**/*.test.tsx",
      "plugins/**/*.test.ts",
      "src-tauri/sidecar/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist", "plugins/markdown-explorer"],
    coverage: {
      provider: "v8",
      include: [
        "ui/**/*.{ts,tsx}",
        "contract/**/*.ts",
        "plugins/*/src/**/*.ts",
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