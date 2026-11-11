/**
 * Runs every word of a language's corpus through the lookup, as the extension
 * sends it, and saves the responses: with the sentence as `context` and `at`
 * (none over 500 characters, as the extension sends none), and each distinct
 * word once more without context. No LLM is involved, so it is the cheap
 * check after a lookup change, before the judge.
 *
 *   bun run dump:lookups --lang ja --run after
 *   bun run dump:lookups --lang ja --run after --base before
 *
 * The texts come from the corpus repo next to this one (`../corpus/<lang>`,
 * or `--texts`). Results go to `apps/server/eval/out/<lang>/dump/<run>.jsonl`.
 * Every run reports where a response breaks the protocol's rules for `match`
 * and `segments`. With `--base`, it also counts how many responses changed
 * and lists the words whose first entry changed, most frequent first.
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { readPairLanguage } from "@dict/core/language";
import { schema } from "@dict/core/schema";
import type { LookupResult } from "../src/lookup/common/entries.ts";
import { lookupWord } from "../src/lookup/lookup.ts";

const { values } = parseArgs({
  options: {
    lang: { type: "string" },
    run: { type: "string" },
    base: { type: "string" },
    texts: { type: "string" },
    target: { type: "string", default: "en" },
  },
});
if (values.lang === undefined || values.run === undefined) {
  throw new Error(
    "Usage: dump:lookups --lang <lang> --run <name> [--base <name>]",
  );
}
const lang = values.lang;
const pair = `${lang}_${values.target}`;
const texts = values.texts ?? `../corpus/${lang}`;
const out = join("apps/server/eval/out", lang, "dump");
const fileOf = (run: string) => join(out, `${run}.jsonl`);

/** One lookup: what was sent and what came back. */
type Line = {
  readonly word: string;
  readonly context?: string;
  readonly at?: number;
  readonly r: LookupResult;
};

/** The extension sends no sentence longer than this (`MAX_SENTENCE_CHARS`). */
const MAX_CONTEXT_CHARS = 500;

/** `raw` with whitespace runs as one space and trimmed, and where each kept character was in `raw`, as the extension does. */
const collapse = (raw: string) => {
  let text = "";
  const rawIndex: Array<number> = [];
  let space = -1;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i]!)) {
      space = space < 0 ? i : space;
      continue;
    }
    if (space >= 0 && text !== "") {
      text += " ";
      rawIndex.push(space);
    }
    space = -1;
    text += raw[i];
    rawIndex.push(i);
  }
  return { text, rawIndex };
};

/** The protocol's `at` for the copy of `word` starting at `start`. */
const copyNumber = (text: string, word: string, start: number) => {
  let count = 0;
  for (
    let i = text.indexOf(word);
    i >= 0 && i <= start;
    i = text.indexOf(word, i + word.length)
  ) {
    count++;
    if (i === start) return count;
  }
  return undefined;
};

const dump = (): ReadonlyArray<Line> => {
  const db = drizzle({
    client: new Database(`data/${pair}.sqlite`, { readonly: true }),
    schema,
  }) as DictionaryDb;
  const language = readPairLanguage(pair);
  const sentences = new Intl.Segmenter(lang, { granularity: "sentence" });
  const segmenter = new Intl.Segmenter(lang, { granularity: "word" });
  const lines: Array<Line> = [];
  const plain = new Set<string>();
  const files = readdirSync(texts, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".md"))
    .sort();
  for (const file of files) {
    const content = readFileSync(join(texts, file), "utf8");
    for (const { segment } of sentences.segment(content)) {
      const { text: sentence, rawIndex } = collapse(segment);
      for (const part of segmenter.segment(segment)) {
        if (!part.isWordLike || !/\p{L}/u.test(part.segment)) continue;
        const word = part.segment.normalize("NFC");
        const clicked = rawIndex.findIndex((i) => i >= part.index);
        const context =
          sentence.length <= MAX_CONTEXT_CHARS ? sentence : undefined;
        const at =
          context === undefined || clicked < 0
            ? undefined
            : copyNumber(sentence, word, clicked);
        lines.push({
          word,
          ...(context !== undefined ? { context } : {}),
          ...(at !== undefined ? { at } : {}),
          r: lookupWord(db, language, word, context, at),
        });
        if (!plain.has(word)) {
          plain.add(word);
          lines.push({ word, r: lookupWord(db, language, word) });
        }
      }
    }
  }
  return lines;
};

/** Where a response breaks the protocol's rules for `match` and `segments`. */
const problems = (lines: ReadonlyArray<Line>): Record<string, number> => {
  const counts: Record<string, number> = {};
  const add = (problem: string) => {
    counts[problem] = (counts[problem] ?? 0) + 1;
  };
  for (const { word, context, r } of lines) {
    for (const entry of r.entries) {
      if (entry.match === undefined) continue;
      if (context === undefined) add("match without context");
      else if (entry.match.length === 1 && entry.match[0] === word) {
        add("match is just the clicked word");
      } else if (!entry.match.some((run) => run.includes(word))) {
        add("match does not hold the clicked word");
      }
    }
    if (r.segments !== undefined) {
      const spelled = r.segments.map((segment) => segment.text).join("");
      const first = r.entries[0]?.match;
      if (spelled !== word && !(first?.length === 1 && first[0] === spelled)) {
        add("segments spell neither the word nor the first match");
      }
      const indexes = r.segments.flatMap((segment) => segment.entries ?? []);
      if (new Set(indexes).size !== indexes.length) {
        add("an entry in two segments");
      }
    }
  }
  return counts;
};

/** The first entry as a reader sees it first: headword, part of speech, reading, and whether it underlines more. */
const firstOf = (r: LookupResult) => {
  const entry = r.entries[0];
  if (entry === undefined) return "(nothing)";
  const reading = entry.pron?.reading;
  return `${entry.lemma} ${entry.pos}${reading === undefined ? "" : ` ${reading}`}${entry.match === undefined ? "" : ` match=${entry.match.join("|")}`}`;
};

const lines = dump();
mkdirSync(out, { recursive: true });
writeFileSync(
  fileOf(values.run),
  lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
);
console.log(`${lines.length} lookups -> ${fileOf(values.run)}`);
console.log("protocol problems:", problems(lines));

if (values.base !== undefined) {
  const baseFile = fileOf(values.base);
  if (!existsSync(baseFile)) throw new Error(`no run at ${baseFile}`);
  const base = readFileSync(baseFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Line);
  if (base.length !== lines.length) {
    throw new Error(
      `${dirname(baseFile)}: the runs looked up different words (${base.length} and ${lines.length}); was the corpus changed?`,
    );
  }
  let changed = 0;
  const firsts = new Map<string, { count: number; context?: string }>();
  base.forEach((before, i) => {
    const after = lines[i]!;
    if (JSON.stringify(before.r) === JSON.stringify(after.r)) return;
    changed++;
    const from = firstOf(before.r);
    const to = firstOf(after.r);
    if (from === to) return;
    const key = `${before.word}: ${from}  ->  ${to}`;
    const seen = firsts.get(key);
    firsts.set(key, {
      count: (seen?.count ?? 0) + 1,
      context: seen?.context ?? before.context,
    });
  });
  console.log(`${changed} of ${lines.length} responses changed`);
  console.log(
    `first entry changed in ${[...firsts.values()].reduce((sum, { count }) => sum + count, 0)}:`,
  );
  for (const [key, { count, context }] of [...firsts].sort(
    (a, b) => b[1].count - a[1].count,
  )) {
    console.log(
      `${String(count).padStart(5)}  ${key}   | ${(context ?? "").slice(0, 40)}`,
    );
  }
}
