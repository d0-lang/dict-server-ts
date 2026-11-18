import { assert, describe, it } from "@effect/vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FEATURE_LABELS } from "./features.ts";
import { explainLabel, readLabels } from "./labels.ts";
import { decodeLanguage, languageCodes, readLanguage } from "./language.ts";

const SINGLE = new Set(Object.values(FEATURE_LABELS));

describe("label explanations", () => {
  it("name every label for English glosses", () => {
    const labels = readLabels(
      decodeLanguage({ code: "xx", name: "X", target: "en" }),
    );
    for (const label of SINGLE) {
      assert.isDefined(labels[label]?.name, label);
    }
  });

  it("read every language's file, which lists only labels that exist", () => {
    for (const code of languageCodes()) {
      const language = readLanguage(code);
      // Labels the lookup adds to a form (`て form`).
      const forms = new Set(
        language.context.analyzer?.formEndings.map((ending) => ending.label),
      );
      const labels = readLabels(language);
      for (const label of Object.keys(labels)) {
        assert.isTrue(
          forms.has(label) ||
            label.split("/").every((part) => SINGLE.has(part)),
          `${code}: ${label}`,
        );
      }
    }
    // A language's own text, under the shared name.
    assert.deepStrictEqual(readLabels(readLanguage("ru")).pf, {
      name: "perfective",
      text: "The action is seen as a whole, usually completed. Most verbs come in pairs: писать (impf) and написать (pf).",
    });
  });

  it("names a combined label by its parts", () => {
    const labels = readLabels(readLanguage("ru"));
    assert.deepStrictEqual(explainLabel(labels, "m/f"), {
      name: "masculine or feminine",
    });
    assert.strictEqual(
      explainLabel(labels, "m/f/n")?.name,
      "masculine, feminine or neuter",
    );
    assert.strictEqual(
      explainLabel(labels, "impf/pf")?.name,
      "imperfective and perfective",
    );
    assert.isUndefined(explainLabel(labels, "m/xyz"));
    assert.isUndefined(explainLabel(labels, "xyz"));
  });

  it("rejects texts longer than the protocol allows, and labels with no name", () => {
    const dir = mkdtempSync(join(tmpdir(), "dict-labels-"));
    try {
      const language = decodeLanguage({ code: "xx", name: "X", target: "en" });
      mkdirSync(join(dir, "xx"));
      writeFileSync(join(dir, "labels.en.toml"), `[m]\nname = "masculine"\n`);
      writeFileSync(
        join(dir, "xx", "labels.toml"),
        `[m]\ntext = "${"a".repeat(1001)}"\n`,
      );
      assert.throws(() => readLabels(language, dir));
      writeFileSync(join(dir, "xx", "labels.toml"), `[f]\ntext = "x"\n`);
      assert.throws(() => readLabels(language, dir), /no name/);
      writeFileSync(
        join(dir, "labels.en.toml"),
        `[m]\nname = "${"a".repeat(61)}"\n`,
      );
      writeFileSync(join(dir, "xx", "labels.toml"), "");
      assert.throws(() => readLabels(language, dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
