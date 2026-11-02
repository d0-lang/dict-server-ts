/**
 * Picks items for judges, the same number from each genre, favouring the words
 * readers meet most. Whichever judge is used, `score.ts` reads the verdicts.
 *
 *   bun eval/sample.ts --run eval/out/pl --name run-1 --batches 5 --size 40
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Item, SampleRecord } from "./types.ts";

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    name: { type: "string" },
    batches: { type: "string", default: "5" },
    size: { type: "string", default: "40" },
    seed: { type: "string", default: "1" },
  },
});
if (!values.run || !values.name) {
  throw new Error("Usage: sample --run <dir> --name <name>");
}
const batchCount = Number(values.batches);
const batchSize = Number(values.size);

// Mulberry32: the same seed gives the same sample.
let state = Number(values.seed) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const items: ReadonlyArray<Item> = readFileSync(
  join(values.run, "items.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const genreOf = (item: Item) => item.text.split("/")[0]!;
const genres = [...new Set(items.map(genreOf))].sort();
const total = batchCount * batchSize;

// Weighted sampling without replacement (Efraimidis-Spirakis).
const picked: Array<Item> = [];
genres.forEach((genre, index) => {
  const share =
    Math.floor(total / genres.length) + (index < total % genres.length ? 1 : 0);
  const ranked = items
    .filter((item) => genreOf(item) === genre)
    .map((item) => ({ item, key: Math.pow(random(), 1 / item.weight) }))
    .sort((a, b) => b.key - a.key);
  // A word once per genre, so "się" can't fill a sample.
  const seen = new Set<string>();
  for (const { item } of ranked) {
    if (seen.size === share) break;
    const word = item.word.toLowerCase();
    if (seen.has(word)) continue;
    seen.add(word);
    picked.push(item);
  }
});

for (let i = picked.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [picked[i], picked[j]] = [picked[j]!, picked[i]!];
}

const dir = join(values.run, values.name);
mkdirSync(dir, { recursive: true });
const records: Array<SampleRecord> = [];
for (let b = 0; b < batchCount; b++) {
  const batch = `batch-${String(b + 1).padStart(2, "0")}`;
  const members = picked
    .slice(b * batchSize, (b + 1) * batchSize)
    .map((item) => ({
      ...item,
      id: Math.floor(random() * 0xffffffff)
        .toString(16)
        .padStart(8, "0"),
      batch,
    }));
  records.push(...members);
  writeFileSync(
    join(dir, `${batch}.json`),
    JSON.stringify(
      members.map(({ id, word, sentence, entries }) => ({
        id,
        word,
        sentence,
        entries: entries.map((entry, index) => ({ index, ...entry })),
      })),
      null,
      1,
    ),
  );
}
writeFileSync(join(dir, "sample.json"), JSON.stringify(records, null, 1));
console.log(`${dir}: ${records.length} items, ${genres.length} genres`);
