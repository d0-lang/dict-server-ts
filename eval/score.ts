/**
 * Summarises judges' verdicts per genre and writes everything below Clear to a
 * review file. Keep each run's `report.json` to compare runs.
 *
 *   bun eval/score.ts --dir eval/out/pl/run-1
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Rating, SampleRecord, Verdict } from "./types.ts";

const { values } = parseArgs({ options: { dir: { type: "string" } } });
if (!values.dir) throw new Error("Usage: score --dir <dir>");
const dir = values.dir;

const sample: ReadonlyArray<SampleRecord> = JSON.parse(
  readFileSync(join(dir, "sample.json"), "utf8"),
);
const verdicts = new Map<string, Verdict>();
for (const batch of new Set(sample.map((record) => record.batch))) {
  const file = join(dir, `${batch}-verdicts.json`);
  if (!existsSync(file)) {
    console.log(`${batch}: no verdicts`);
    continue;
  }
  for (const verdict of JSON.parse(readFileSync(file, "utf8"))) {
    verdicts.set(verdict.id, verdict);
  }
}

const judged = sample.flatMap((record) => {
  const verdict = verdicts.get(record.id);
  return verdict ? [{ ...record, verdict }] : [];
});
console.log(`Judged ${judged.length} of ${sample.length}\n`);

const RATINGS: ReadonlyArray<Rating> = [
  "clear",
  "buried",
  "misleading",
  "no_help",
];
const row = (list: typeof judged) => ({
  items: list.length,
  ...Object.fromEntries(
    RATINGS.map((rating) => [
      rating,
      list.filter((item) => item.verdict.rating === rating).length,
    ]),
  ),
  clearPct: Number(
    (
      (100 * list.filter((item) => item.verdict.rating === "clear").length) /
      Math.max(list.length, 1)
    ).toFixed(1),
  ),
});
const genreOf = (item: { text: string }) => item.text.split("/")[0]!;
const byGenre = Object.fromEntries(
  [...new Set(judged.map(genreOf))]
    .sort()
    .map((genre) => [
      genre,
      row(judged.filter((item) => genreOf(item) === genre)),
    ]),
);
const overall = row(judged);
console.table({ ...byGenre, overall });

const causes: Record<string, Record<string, number>> = {};
for (const { verdict } of judged) {
  if (verdict.rating === "clear") continue;
  const counts = (causes[verdict.cause] ??= {});
  counts[verdict.rating] = (counts[verdict.rating] ?? 0) + 1;
}
console.log("Causes of everything below Clear:");
console.table(causes);

const changed = judged.filter(
  ({ verdict }) => verdict.first_rating !== verdict.rating,
);
console.log(`Second look changed ${changed.length} ratings`);
const missed = judged.filter((item) => item.entries.length === 0);
console.log(`Misses in sample: ${missed.length}, as rated:`, row(missed));

writeFileSync(
  join(dir, "report.json"),
  JSON.stringify({ overall, byGenre, causes }, null, 1),
);
writeFileSync(
  join(dir, "review.json"),
  JSON.stringify(
    judged.filter(({ verdict }) => verdict.rating !== "clear"),
    null,
    1,
  ),
);
