import { assert, describe, it } from "@effect/vitest";
import { pairLabels } from "./labels.ts";
import { languageOf } from "./testing/dictionary.ts";
import { japanese } from "./testing/japanese.ts";

describe("pairLabels", () => {
  it("explains the label the lookup adds to a て form", () => {
    const labels = pairLabels(japanese, languageOf("ja_en"));
    assert.strictEqual(labels["て form"]?.name, "て form");
    assert.match(labels["て form"]?.text ?? "", /links it to what follows/);
  });
});
