import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/testSetup.ts"],
    // The sidecar is plain CommonJS with no build step, so it had no way to be covered: the globs
    // matched `.ts` only. Its tests are `.test.ts` files that `require` the `.cjs` modules directly.
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "plugins/**/*.test.ts",
      "src-tauri/sidecar/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist"],
  },
});
