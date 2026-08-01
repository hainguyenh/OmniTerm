import { defineConfig } from "vitest/config";

const COVERAGE_THRESHOLD = 85;

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
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      // Explicit includes make untested production files visible instead of reporting only modules
      // imported by a test. Rust is summarized separately by cargo-llvm-cov.
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
      ],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage-js",
      reportOnFailure: true,
      thresholds: {
        lines: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
      },
    },
  },
});
