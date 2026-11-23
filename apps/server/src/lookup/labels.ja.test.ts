import { assert, describe, it } from "@effect/vitest";
import { pairLabels } from "./labels.ts";
import { languageOf } from "./testing/dictionary.ts";
import { japanese } from "./testing/japanese.ts";

describe("pairLabels", () => {
  it("explains the labels the lookup adds to a て form and an adverb", () => {
    const labels = pairLabels(japanese, languageOf("ja_en"));
    assert.strictEqual(labels["て form"]?.name, "て form");
    assert.match(labels["て form"]?.text ?? "", /links it to what follows/);
    assert.strictEqual(labels["adverb"]?.name, "adverb");
    assert.match(labels["adverb"]?.text ?? "", /makes it an adverb/);
  });
});
