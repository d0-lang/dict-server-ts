import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Schema } from "effect";
import type { ImportStats } from "./stats.ts";

/**
 * `dumps.toml`: which dump snapshot each language is imported from. A
 * snapshot is a pre-release of this repo, `dump-<date>`, holding one gzipped
 * `<lang>.jsonl` per language; the dump canary makes them
 * (`.github/workflows/canary.yml`) and opens the PR that moves the pins.
 */
export const DUMPS_FILE = "dumps.toml";

const Snapshot = Schema.String.check(
  Schema.isPattern(/^dump-\d{4}-\d{2}-\d{2}$/),
);

export const isSnapshot = Schema.is(Snapshot);

const DumpsFile = Schema.Struct({
  languages: Schema.optionalKey(Schema.Record(Schema.String, Snapshot)),
});

export type Pins = Readonly<Record<string, string>>;

/** The pins in `dumps.toml`; none when it is missing. Throws when it is invalid. */
export const readPins = (file = DUMPS_FILE): Pins =>
  existsSync(file)
    ? (Schema.decodeUnknownSync(DumpsFile)(
        Bun.TOML.parse(readFileSync(file, "utf8")),
      ).languages ?? {})
    : {};

const HEADER = `# Which dump snapshot each language is imported from: a pre-release of this
# repo, \`dump-<date>\`, with one gzipped <lang>.jsonl per language. The dump
# canary (.github/workflows/canary.yml) makes the snapshots and opens the PR
# that moves these pins.
`;

/** `dumps.toml` with these pins, sorted by language. */
export const formatPins = (pins: Pins): string =>
  `${HEADER}\n[languages]\n${Object.keys(pins)
    .sort()
    .map((lang) => `${lang} = "${pins[lang]}"\n`)
    .join("")}`;

export const writePins = (pins: Pins, file = DUMPS_FILE): void =>
  writeFileSync(file, formatPins(pins));

/** One language's import from the pinned snapshot (`old`, absent when unpinned) and from the new one. */
export type Comparison = {
  readonly lang: string;
  readonly old?: ImportStats;
  readonly new?: ImportStats;
};

const totalForms = (stats: ImportStats) =>
  Object.values(stats.forms).reduce((sum, n) => sum + n, 0);

const COLUMNS: ReadonlyArray<
  readonly [string, (stats: ImportStats) => number]
> = [
  ["Entries", (stats) => stats.entries],
  ["Senses", (stats) => stats.senses],
  ["Forms", totalForms],
  ["Invalid lines", (stats) => stats.invalidLines],
  ["Lines without entry", (stats) => stats.linesWithoutEntry],
];

/** A change above this share is set in bold, so it stands out in review. */
const NOTABLE = 0.05;

const cell = (old: number | undefined, next: number): string => {
  const value = next.toLocaleString("en-US");
  if (old === undefined) return value;
  if (old === next) return `${value} (=)`;
  const change = old === 0 ? Infinity : (next - old) / old;
  const sign = next > old ? "+" : "−";
  const percent =
    change === Infinity
      ? "new"
      : `${sign}${Math.abs(change * 100).toFixed(1)}%`;
  const text = `${value} (${percent})`;
  return Math.abs(change) > NOTABLE ? `**${text}**` : text;
};

/**
 * A Markdown table per language of what the new snapshot's import counts,
 * with the change from the pinned snapshot's. A language whose new import
 * failed is listed under the table.
 */
export const reportComparisons = (
  comparisons: ReadonlyArray<Comparison>,
): string => {
  const done = comparisons.filter((c) => c.new !== undefined);
  const failed = comparisons.filter((c) => c.new === undefined);
  const lines = [
    `| Language | ${COLUMNS.map(([name]) => name).join(" | ")} |`,
    `| --- |${COLUMNS.map(() => " ---: |").join("")}`,
    ...done.map(
      (c) =>
        `| ${c.lang} | ${COLUMNS.map(([, get]) =>
          cell(c.old === undefined ? undefined : get(c.old), get(c.new!)),
        ).join(" | ")} |`,
    ),
  ];
  const unpinned = done.filter((c) => c.old === undefined).map((c) => c.lang);
  if (unpinned.length > 0) {
    lines.push(
      "",
      `Not pinned before, so nothing to compare: ${unpinned.join(", ")}.`,
    );
  }
  if (failed.length > 0) {
    lines.push(
      "",
      `The import failed for: ${failed.map((c) => c.lang).join(", ")}.`,
    );
  }
  return lines.join("\n") + "\n";
};
