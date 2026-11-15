import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "boundaries.test.ts",
      ".github/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
    ],
  },
});
