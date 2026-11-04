/**
 * Sends every word of a folder of texts through the real `/v1/lookup` and saves
 * what came back, one record per word in its sentence. No judgement happens here.
 *
 *   bun eval/collect.ts --texts <dir> --lang pl_en --out eval/out/pl
 *
 * Like the extension, it sends the sentence as `context` when the server lists
 * the `context` feature. `--context off` leaves it out.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Entry, Item, Segment } from "./types.ts";

const { values } = parseArgs({
  options: {
    texts: { type: "string" },
    lang: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: "http://127.0.0.1:37421" },
    // The same word in many sentences adds cost faster than it adds information.
    "per-word": { type: "string", default: "3" },
    context: { type: "string", default: "on" },
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

const meta = (await (
  await fetch(new URL("/v1/get-meta", base), { headers: { "x-nonce": "eval" } })
).json()) as { features?: ReadonlyArray<string> };
const sendContext = values.context !== "off" && (meta.features ?? []).includes("context");
console.log(`context: ${sendContext ? "sent" : "not sent"}`);

type Found = { readonly entries: ReadonlyArray<Entry>; readonly segments?: ReadonlyArray<Segment> };
const cache = new Map<string, Found>();
const lookup = async (word: string, sentence: string): Promise<Found> => {
  const cacheKey = sendContext ? `${word}\0${sentence}` : word;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const url = new URL("/v1/lookup", base);
  url.searchParams.set("word", word);
  url.searchParams.set("lang", lang);
  if (sendContext) url.searchParams.set("context", sentence);
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
    segments?: ReadonlyArray<Segment>;
  };
  const found: Found = {
    entries: body.entries.map((entry) => ({
      lemma: entry.lemma,
      pos: entry.pos,
      senses: entry.senses.map((sense) => sense.translations.join("; ")),
    })),
    ...(body.segments !== undefined ? { segments: body.segments } : {}),
  };
  cache.set(cacheKey, found);
  return found;
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
      const found = await lookup(surface, sentence);
      const { entries } = found;
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
      items.push({ word: surface, sentence, text, ...found, weight: 0 });
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
