import { assert, describe, it } from "@effect/vitest";
import { lookupKey } from "./lookupKey.ts";

describe("lookupKey", () => {
  it("drops stress marks from Cyrillic words", () => {
    assert.strictEqual(lookupKey("соба́ки"), "собаки");
    // NFC writes `е` + grave as one letter, `ѐ`.
    assert.strictEqual(lookupKey("всѐ"), "все");
  });

  it("keeps the letters й and ё, and accents outside Cyrillic", () => {
    assert.strictEqual(lookupKey("Йо́гурт"), "йогурт");
    assert.strictEqual(lookupKey("всё"), "всё");
    assert.strictEqual(lookupKey("Kraków"), "kraków");
    assert.strictEqual(lookupKey("café"), "café");
  });
});
