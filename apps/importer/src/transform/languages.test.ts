import { assert, describe, it } from "@effect/vitest";
import { readLanguage } from "@dict/core/language";
import { importRules, isHistorical } from "./languages.ts";

describe("language rules", () => {
  it("matches a historical stage only when all of its tags are present", () => {
    const pl = importRules(readLanguage("pl"));
    assert.isTrue(isHistorical(pl, ["Middle", "Polish", "feminine"]));
    assert.isFalse(isHistorical(pl, ["Polish", "feminine"]));
    assert.isFalse(isHistorical(pl, undefined));
  });
});
