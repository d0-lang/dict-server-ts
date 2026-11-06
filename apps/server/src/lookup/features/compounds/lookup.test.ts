import { assert, describe, it } from "@effect/vitest";
import { surfaceSlices } from "./lookup.ts";

describe("segments", () => {
  it("slices the word as sent, or gives up when normalizing changed it", () => {
    assert.deepStrictEqual(
      surfaceSlices("Schifffahrtsgeschichte", [
        "schifffahrt",
        "s",
        "geschichte",
      ]),
      ["Schifffahrt", "s", "geschichte"],
    );
    assert.strictEqual(
      surfaceSlices("Gemüsefonds", ["gemüse", "fonds"]),
      undefined,
    );
    assert.strictEqual(
      surfaceSlices(" Gemüsefonds", ["gemüse", "fonds"]),
      undefined,
    );
  });
});
