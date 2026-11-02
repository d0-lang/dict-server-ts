/**
 * Sends every word of a folder of texts through the real `/v1/lookup` and saves
 * what came back, one record per word in its sentence. No judgement happens here.
 *
 *   bun eval/collect.ts --texts <dir> --lang pl_en --out eval/out/pl
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Entry, Item } from "./types.ts";

const { values } = parseArgs({
  options: {
    texts: { type: "string" },
    lang: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: "http://127.0.0.1:37421" },
    // The same word in many sentences adds cost faster than it adds information.
    "per-word": { type: "string", default: "3" },
  },
});
if (!values.texts || !values.lang || !values.out) {
  throw new Error("Usage: collect --texts <dir> --lang <pair> --out <dir>");
}
const { texts, lang, out, base } = values;
const perWordCap = Number(values["per-word"]);

const locale = lang.split("_")[0];
const sentenceSegmenter = new Intl.Segmenter(locale, {
  granularity: "sentence",
});
const wordSegmenter = new Intl.Segmenter(locale, { granularity: "word" });

const cache = new Map<string, ReadonlyArray<Entry>>();
const lookup = async (word: string): Promise<ReadonlyArray<Entry>> => {
  const cached = cache.get(word);
  if (cached !== undefined) return cached;
  const url = new URL("/v1/lookup", base);
  url.searchParams.set("word", word);
  url.searchParams.set("lang", lang);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${word}: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    entries: ReadonlyArray<{
      lemma: string;
      pos: string;
      senses: ReadonlyArray<{ translations: ReadonlyArray<string> }>;
    }>;
  };
  const entries = body.entries.map((entry) => ({
    lemma: entry.lemma,
    pos: entry.pos,
    senses: entry.senses.map((sense) => sense.translations.join("; ")),
  }));
  cache.set(word, entries);
  return entries;
};

type TextStats = {
  words: number;
  found: number;
  missed: number;
  ambiguous: number;
};
const stats: Record<string, TextStats> = {};
const counts = new Map<string, number>();
const items: Array<Item> = [];
const seenPairs = new Set<string>();
const perWord = new Map<string, number>();

// Texts live in genre folders, e.g. `news/0001.md`.
const textFiles = readdirSync(texts, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".md"))
  .sort();
for (const text of textFiles) {
  const content = readFileSync(join(texts, text), "utf8");
  const stat: TextStats = { words: 0, found: 0, missed: 0, ambiguous: 0 };
  stats[text] = stat;
  for (const { segment } of sentenceSegmenter.segment(content)) {
    const sentence = segment.replace(/\s+/g, " ").trim();
    for (const part of wordSegmenter.segment(segment)) {
      // The same filter as the extension's tokenizer.
      if (!part.isWordLike || !/\p{L}/u.test(part.segment)) continue;
      const surface = part.segment.normalize("NFC");
      const word = surface.toLowerCase();
      const entries = await lookup(surface);
      stat.words++;
      counts.set(word, (counts.get(word) ?? 0) + 1);
      if (entries.length === 0) {
        stat.missed++;
      } else {
        stat.found++;
        const lemmas = new Set(entries.map((e) => e.lemma.toLowerCase()));
        if (lemmas.size > 1) stat.ambiguous++;
      }

      const pair = `${word}\t${sentence}`;
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      const used = perWord.get(word) ?? 0;
      if (used >= perWordCap) continue;
      perWord.set(word, used + 1);
      items.push({ word: surface, sentence, text, entries, weight: 0 });
    }
  }
}

// How often this item's word occurs per saved item, so a sample can follow what readers meet.
const weighted = items.map((item) => {
  const word = item.word.toLowerCase();
  return { ...item, weight: counts.get(word)! / perWord.get(word)! };
});

mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "items.jsonl"),
  weighted.map((item) => JSON.stringify(item)).join("\n") + "\n",
);
writeFileSync(join(out, "stats.json"), JSON.stringify(stats, null, 1));

console.table(stats);
console.log(`${items.length} items for ${perWord.size} words`);
