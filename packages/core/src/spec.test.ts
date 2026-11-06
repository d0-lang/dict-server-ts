import { assert, describe, it } from "@effect/vitest";
import { existsSync, readFileSync } from "node:fs";
import { SPEC_FILES } from "./spec.ts";

describe("generated spec files", () => {
  it("are up to date (run `bun run spec`)", () => {
    for (const [file, render] of SPEC_FILES) {
      assert.isTrue(existsSync(file), file);
      assert.strictEqual(readFileSync(file, "utf8"), render(), file);
    }
  });
});
