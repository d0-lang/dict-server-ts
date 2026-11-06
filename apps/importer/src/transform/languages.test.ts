import { assert, describe, it } from "@effect/vitest";
import { LANGUAGES, isHistorical } from "./languages.ts";

describe("language rules", () => {
  // `every` is true on an empty list, so an empty stage would match all data.
  it("has no empty historical stage", () => {
    for (const rules of Object.values(LANGUAGES)) {
      for (const stage of rules.historicalStages) {
        assert.isAbove(stage.length, 0, rules.code);
      }
    }
  });

  it("matches a historical stage only when all of its tags are present", () => {
    const pl = LANGUAGES.pl!;
    assert.isTrue(isHistorical(pl, ["Middle", "Polish", "feminine"]));
    assert.isFalse(isHistorical(pl, ["Polish", "feminine"]));
    assert.isFalse(isHistorical(pl, undefined));
  });
});
