import { assert, describe, it } from "@effect/vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatPins,
  isSnapshot,
  readPins,
  reportComparisons,
  writePins,
} from "./dumps.ts";
import type { ImportStats } from "./stats.ts";

const dir = () => mkdtempSync(join(tmpdir(), "dict-dumps-"));

const stats = (counts: Partial<ImportStats>): ImportStats =>
  ({
    entries: 100,
    senses: 200,
    invalidLines: 0,
    linesWithoutEntry: 3,
    forms: {
      lemma: 100,
      inflection: 400,
      formOf: 0,
      abbreviation: 0,
      letterVariant: 0,
    },
    ...counts,
  }) as ImportStats;

describe("dumps.toml", () => {
  it("writes the pins sorted and reads them back", () => {
    const file = join(dir(), "dumps.toml");
    writePins({ pl: "dump-2026-10-30", de: "dump-2026-11-06" }, file);
    assert.deepStrictEqual(readPins(file), {
      de: "dump-2026-11-06",
      pl: "dump-2026-10-30",
    });
    assert.match(
      formatPins({ pl: "dump-2026-10-30", de: "dump-2026-11-06" }),
      /\[languages\]\nde = "dump-2026-11-06"\npl = "dump-2026-10-30"\n$/,
    );
  });

  it("has no pins without the file or the table", () => {
    assert.deepStrictEqual(readPins(join(dir(), "missing.toml")), {});
    const file = join(dir(), "dumps.toml");
    writePins({}, file);
    assert.deepStrictEqual(readPins(file), {});
  });

  it("refuses a pin that is not a snapshot name", () => {
    const file = join(dir(), "dumps.toml");
    writeFileSync(file, '[languages]\nde = "latest"\n');
    assert.throws(() => readPins(file));
    assert.isTrue(isSnapshot("dump-2026-10-30"));
    assert.isFalse(isSnapshot("dump-latest"));
  });
});

describe("reportComparisons", () => {
  it("shows each count with its change, bold above 5%", () => {
    const report = reportComparisons([
      {
        lang: "de",
        old: stats({}),
        new: stats({ entries: 102, senses: 230 }),
      },
    ]);
    const row = report.split("\n")[2];
    assert.strictEqual(
      row,
      "| de | 102 (+2.0%) | **230 (+15.0%)** | 500 (=) | 0 (=) | 3 (=) |",
    );
  });

  it("adds each language's diff, its examples folded away", () => {
    const report = reportComparisons([
      {
        lang: "de",
        old: stats({}),
        new: stats({}),
        diff: {
          entries: { added: 1, removed: 0, changed: 0 },
          forms: { added: 1200, removed: 0 },
          examples: {
            addedEntries: ["Hund (NOUN)"],
            removedEntries: [],
            changedEntries: [],
            addedForms: ["Hunde -> Hund (NOUN)"],
            removedForms: [],
          },
        },
      },
    ]);
    assert.include(
      report,
      "<details><summary><b>de</b>: entries 1 added, 0 removed, 0 changed; forms 1,200 added, 0 removed</summary>",
    );
    assert.include(report, "Entries added:\n\n- Hund (NOUN)\n");
    assert.include(report, "Forms added:\n\n- Hunde -> Hund (NOUN)\n");
    assert.notInclude(report, "Entries removed:");
  });

  it("lists unpinned languages and failed imports under the table", () => {
    const report = reportComparisons([
      { lang: "es", new: stats({}) },
      { lang: "ja", old: stats({}) },
    ]);
    assert.include(report, "| es | 100 | 200 | 500 | 0 | 3 |");
    assert.include(report, "Not pinned before, so nothing to compare: es.");
    assert.include(report, "The import failed for: ja.");
  });
});
