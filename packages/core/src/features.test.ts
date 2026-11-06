import { assert, describe, it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEATURE_POS,
  FEATURE_TAGS,
  FEATURES,
  featuresOfTags,
  formatFeatures,
  parseFeatures,
} from "./features.ts";

const spec = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "spec",
      "dictionary",
      "features.json",
    ),
    "utf8",
  ),
);

describe("features", () => {
  it("matches spec/dictionary/features.json", () => {
    assert.deepStrictEqual(spec.features, FEATURES);
    assert.deepStrictEqual(spec.pos, [...FEATURE_POS]);
    assert.deepStrictEqual(spec.tags, FEATURE_TAGS);
  });

  it("reads tags into a UD feature string and back", () => {
    const features = featuresOfTags([
      "feminine",
      "animate",
      "nominative",
      "masculine",
    ]);
    assert.deepStrictEqual(features, {
      Gender: ["Masc", "Fem"],
      Animacy: ["Anim"],
    });
    const text = formatFeatures(features);
    assert.strictEqual(text, "Animacy=Anim|Gender=Masc,Fem");
    assert.deepStrictEqual(parseFeatures(text), features);
  });

  it("gives nothing for words without grammar tags", () => {
    assert.strictEqual(
      formatFeatures(featuresOfTags(["transitive"])),
      undefined,
    );
    assert.deepStrictEqual(parseFeatures(null), {});
  });
});
