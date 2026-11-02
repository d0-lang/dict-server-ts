/**
 * Three scores: does the reader understand, is what's shown worth reading, and
 * does what fits come first. With `--base`, also what changed from an earlier run.
 *
 *   bun eval/score.ts --dir eval/out/pl/after --base eval/out/pl/base
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { groupEntries, renderPopover, verdictKey } from "./popover.ts";
import type { SampleRecord, Verdict } from "./types.ts";

const { values } = parseArgs({
  options: { dir: { type: "string" }, base: { type: "string" }, cache: { type: "string" } },
});
if (!values.dir) throw new Error("Usage: score --dir <dir> [--base <dir>]");
const dir = values.dir;
const cachePath = resolve(values.cache ?? join(dirname(dir), "verdicts.jsonl"));
const prompt = readFileSync(resolve(import.meta.dirname, "judge-prompt.md"), "utf8");

const cache = new Map<string, Verdict>(
  existsSync(cachePath)
    ? readFileSync(cachePath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const record = JSON.parse(line);
          return [record.key, record];
        })
    : [],
);

type Judged = SampleRecord & { readonly verdict: Verdict; readonly senseCount: number; readonly junk: number; readonly marginal: number };

const load = (path: string): ReadonlyArray<Judged> => {
  const sample: ReadonlyArray<SampleRecord> = JSON.parse(readFileSync(join(path, "sample.json"), "utf8"));
  return sample.flatMap((item) => {
    const verdict = cache.get(verdictKey(item, prompt));
    if (!verdict) return [];
    const groups = groupEntries(item.entries);
    let junk = 0;
    let marginal = 0;
    groups.forEach((group, g) => {
      group.senses.forEach((_, s) => {
        const flag = verdict.flags[`${g + 1}.${s + 1}`] ?? verdict.flags[`${g + 1}`];
        if (flag === "junk") junk++;
        if (flag === "marginal") marginal++;
      });
    });
    const senseCount = groups.reduce((sum, group) => sum + group.senses.length, 0);
    return [{ ...item, verdict, senseCount, junk, marginal }];
  });
};

const percent = (part: number, whole: number) => Number(((100 * part) / Math.max(whole, 1)).toFixed(1));

const scores = (list: ReadonlyArray<Judged>) => {
  const withEntries = list.filter((item) => item.entries.length > 0);
  const senses = withEntries.reduce((sum, item) => sum + item.senseCount, 0);
  const fitting = list.filter((item) => item.verdict.fits);
  const groupOf = (item: Judged) => Number(item.verdict.fits!.split(".")[0]);
  const senseOf = (item: Judged) => Number(item.verdict.fits!.split(".")[1]);
  return {
    items: list.length,
    understoodPct: percent(list.filter((item) => item.verdict.understood === "yes").length, list.length),
    partly: list.filter((item) => item.verdict.understood === "partly").length,
    wrong: list.filter((item) => item.verdict.understood === "wrong").length,
    no: list.filter((item) => item.verdict.understood === "no").length,
    junkSensePct: percent(withEntries.reduce((sum, item) => sum + item.junk, 0), senses),
    marginalSensePct: percent(withEntries.reduce((sum, item) => sum + item.marginal, 0), senses),
    popoversWithJunkPct: percent(withEntries.filter((item) => item.junk > 0).length, withEntries.length),
    fitsInFirstGroupPct: percent(fitting.filter((item) => groupOf(item) === 1).length, fitting.length),
    fitsAsFirstSensePct: percent(fitting.filter((item) => groupOf(item) === 1 && senseOf(item) === 1).length, fitting.length),
  };
};

const judged = load(dir);
const expected = (JSON.parse(readFileSync(join(dir, "sample.json"), "utf8")) as Array<unknown>).length;
console.log(`Judged ${judged.length} of ${expected}\n`);

const strata = { overall: judged, frequent: judged.filter((i) => i.stratum === "frequent"), random: judged.filter((i) => i.stratum === "random") };
const table = Object.fromEntries(Object.entries(strata).map(([name, list]) => [name, scores(list)]));
console.table(table);

const causes: Record<string, number> = {};
for (const { verdict } of judged) {
  if (verdict.understood !== "yes") causes[verdict.cause] = (causes[verdict.cause] ?? 0) + 1;
}
console.log("Causes of everything not understood:");
console.table(causes);

const RANK = { yes: 3, partly: 2, wrong: 1, no: 0 } as const;
let comparison: unknown = undefined;
if (values.base) {
  const before = new Map(load(values.base).map((item) => [`${item.word}\t${item.sentence}`, item]));
  const pairs = judged.flatMap((item) => {
    const old = before.get(`${item.word}\t${item.sentence}`);
    return old ? [{ item, old }] : [];
  });
  const summary = ({ item, old }: (typeof pairs)[number]) => ({
    word: item.word,
    sentence: item.sentence,
    understood: `${old.verdict.understood} -> ${item.verdict.understood}`,
    fits: `${old.verdict.fits} -> ${item.verdict.fits}`,
    junk: `${old.junk} -> ${item.junk}`,
    marginal: `${old.marginal} -> ${item.marginal}`,
    note: item.verdict.note,
    before: renderPopover(old.entries),
    after: renderPopover(item.entries),
  });
  const changedPopover = pairs.filter((p) => renderPopover(p.item.entries) !== renderPopover(p.old.entries));
  const worse = changedPopover.filter((p) => RANK[p.item.verdict.understood] < RANK[p.old.verdict.understood]);
  const better = changedPopover.filter((p) => RANK[p.item.verdict.understood] > RANK[p.old.verdict.understood]);
  console.log(`\nCompared with ${values.base}: ${pairs.length} shared items, ${changedPopover.length} popovers changed, ${better.length} understood better, ${worse.length} worse`);
  console.table({ before: scores(pairs.map((p) => p.old)), after: scores(pairs.map((p) => p.item)) });
  for (const p of worse) console.log(`WORSE ${p.item.word}: ${p.old.verdict.understood} -> ${p.item.verdict.understood} | ${p.item.verdict.note}`);
  comparison = {
    before: scores(pairs.map((p) => p.old)),
    after: scores(pairs.map((p) => p.item)),
    worse: worse.map(summary),
    better: better.map(summary),
    changed: changedPopover.map(summary),
  };
  writeFileSync(join(dir, "comparison.json"), JSON.stringify(comparison, null, 1));
}

writeFileSync(join(dir, "report.json"), JSON.stringify({ table, causes }, null, 1));
writeFileSync(
  join(dir, "review.json"),
  JSON.stringify(
    judged
      .filter((item) => item.verdict.understood !== "yes" || item.junk > 0 || item.marginal > 0)
      .map(({ word, sentence, text, stratum, verdict, entries }) => ({ word, sentence, text, stratum, verdict, popover: renderPopover(entries) })),
    null,
    1,
  ),
);
