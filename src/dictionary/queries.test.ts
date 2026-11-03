import { assert, describe, it } from "@effect/vitest";
import { caseClass } from "./lookupKey.ts";
import { CaseClass } from "./schema.ts";

describe("caseClass", () => {
  it("classifies lowercase, capitalised and all-caps words", () => {
    assert.strictEqual(caseClass("oder"), CaseClass.Lower);
    assert.strictEqual(caseClass("Oder"), CaseClass.Capitalised);
    assert.strictEqual(caseClass("AM"), CaseClass.AllCaps);
    assert.strictEqual(caseClass("Am"), CaseClass.Capitalised);
    assert.strictEqual(caseClass("Ü"), CaseClass.Capitalised); // one letter
    assert.strictEqual(caseClass("ÜBER"), CaseClass.AllCaps);
    assert.strictEqual(caseClass("2024"), CaseClass.Capitalised);
    assert.strictEqual(caseClass("bzw."), CaseClass.Lower);
  });
});
