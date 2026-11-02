/**
 * Picks items for judges: the words readers meet most, then a random sample of
 * the rest. The most frequent words get several sentences, since they tend to
 * have several uses.
 *
 *   bun eval/sample.ts --run eval/out/pl --name base --frequent 700 --random 300
 *
 * With `--from <name>` it takes the same words and sentences as an earlier run,
 * with today's lookup results, so two runs can be compared.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Item, SampleRecord } from "./types.ts";

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    name: { type: "string" },
    frequent: { type: "string", default: "700" },
    random: { type: "string", default: "300" },
    "top-words": { type: "string", default: "100" },
    sentences: { type: "string", default: "3" },
    seed: { type: "string", default: "1" },
    from: { type: "string" },
  },
});
if (!values.run || !values.name) {
  throw new Error("Usage: sample --run <dir> --name <name>");
}

const items: ReadonlyArray<Item> = readFileSync(join(values.run, "items.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const dir = join(values.run, values.name);
mkdirSync(dir, { recursive: true });
const write = (records: ReadonlyArray<SampleRecord>) => {
  writeFileSync(join(dir, "sample.json"), JSON.stringify(records, null, 1));
  console.log(`${dir}: ${records.length} items`);
};

const pairKey = (item: Item) => `${item.word.toLowerCase()}\t${item.sentence}`;

if (values.from) {
  const earlier: ReadonlyArray<SampleRecord> = JSON.parse(
    readFileSync(join(values.run, values.from, "sample.json"), "utf8"),
  );
  const current = new Map(items.map((item) => [pairKey(item), item]));
  const records = earlier.flatMap((old) => {
    const item = current.get(pairKey(old));
    return item ? [{ ...item, stratum: old.stratum }] : [];
  });
  if (records.length < earlier.length) {
    console.log(`${earlier.length - records.length} earlier items are no longer collected`);
  }
  write(records);
} else {
  // Mulberry32: the same seed gives the same sample.
  let state = Number(values.seed) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = <T>(list: ReadonlyArray<T>): Array<T> => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };

  const byWord = new Map<string, Array<Item>>();
  for (const item of items) {
    const word = item.word.toLowerCase();
    byWord.set(word, [...(byWord.get(word) ?? []), item]);
  }
  // `weight` is occurrences per saved item, so the sum is the word's frequency.
  const frequency = (list: ReadonlyArray<Item>) => list.reduce((sum, item) => sum + item.weight, 0);
  const ranked = [...byWord.values()].sort(
    (a, b) => frequency(b) - frequency(a) || a[0]!.word.localeCompare(b[0]!.word),
  );

  const frequentCount = Number(values.frequent);
  const topWords = Number(values["top-words"]);
  const sentences = Number(values.sentences);
  const records: Array<SampleRecord> = [];
  let next = 0;
  for (; next < ranked.length && records.length < frequentCount; next++) {
    const take = next < topWords ? sentences : 1;
    for (const item of shuffled(ranked[next]!).slice(0, take)) {
      if (records.length < frequentCount) records.push({ ...item, stratum: "frequent" });
    }
  }
  const rest = shuffled(ranked.slice(next)).slice(0, Number(values.random));
  for (const list of rest) {
    records.push({ ...shuffled(list)[0]!, stratum: "random" });
  }
  console.log(`Frequent words covered: ${next}, of ${ranked.length}`);
  write(records);
}
