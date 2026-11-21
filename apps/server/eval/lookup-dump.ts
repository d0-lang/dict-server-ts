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
 * and `segments`, and what a lookup costs: its time and the SQL statements it
 * runs, saved next to the run as `<run>.cost.json`. With `--base`, it also
 * counts how many responses changed, lists the words whose first entry
 * changed, most frequent first, and compares the cost with the base run's.
 * Times depend on the machine and what else runs on it: compare runs made
 * alike. The dictionaries are read from `DATA_DIR` (default `data`), as the
 * server reads them, so two builds can be compared without replacing them.
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
import { loadAnalyzer } from "../src/lookup/common/analyzer.ts";
import { DATA_DIR } from "../src/config.ts";
import type { LookupResult } from "../src/lookup/common/entries.ts";
import { compoundRules } from "../src/lookup/features/compounds/split.ts";
import { warmCompounds } from "../src/lookup/features/compounds/stems.ts";
import { phraseIndex } from "../src/lookup/features/phrases/phraseIndex.ts";
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
const costFileOf = (run: string) => join(out, `${run}.cost.json`);

/** What the lookups cost: milliseconds and SQL statements per lookup. */
type Cost = {
  readonly lookups: number;
  readonly ms: {
    readonly mean: number;
    readonly p50: number;
    readonly p99: number;
  };
  readonly sql: { readonly mean: number; readonly p99: number };
};

/**
 * Counts the SQL statements `client` runs. Every statement it prepares, with
 * `query` (cached) or `prepare` (drizzle's), counts each call that runs it.
 */
const countStatements = (client: Database): (() => number) => {
  let count = 0;
  const counting = new WeakSet<object>();
  const counted = <S extends object>(statement: S): S => {
    if (counting.has(statement)) return statement;
    counting.add(statement);
    const methods = statement as unknown as Record<string, unknown>;
    for (const name of ["all", "get", "run", "values", "iterate"]) {
      const run = methods[name];
      if (typeof run !== "function") continue;
      methods[name] = (...args: Array<unknown>) => {
        count++;
        return run.apply(statement, args);
      };
    }
    return statement;
  };
  const { query, prepare } = client;
  client.query = ((sql: string) =>
    counted(query.call(client, sql))) as unknown as typeof client.query;
  client.prepare = ((...args: Parameters<typeof prepare>) =>
    counted(prepare.apply(client, args))) as unknown as typeof client.prepare;
  return () => count;
};

/** The value below which a share `p` of the sorted `values` fall. */
const percentile = (sorted: ReadonlyArray<number>, p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

const costOf = (
  ms: ReadonlyArray<number>,
  sql: ReadonlyArray<number>,
): Cost => {
  const round = (n: number) => Math.round(n * 100) / 100;
  const mean = (values: ReadonlyArray<number>) =>
    values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length);
  const sortedMs = [...ms].sort((a, b) => a - b);
  const sortedSql = [...sql].sort((a, b) => a - b);
  return {
    lookups: ms.length,
    ms: {
      mean: round(mean(ms)),
      p50: round(percentile(sortedMs, 0.5)),
      p99: round(percentile(sortedMs, 0.99)),
    },
    sql: { mean: round(mean(sql)), p99: percentile(sortedSql, 0.99) },
  };
};

const describeCost = (cost: Cost) =>
  `${cost.ms.mean} ms mean, ${cost.ms.p50} p50, ${cost.ms.p99} p99; ${cost.sql.mean} SQL statements mean, ${cost.sql.p99} p99`;

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

const dump = async (): Promise<{
  lines: ReadonlyArray<Line>;
  cost: Cost;
}> => {
  const client = new Database(`${DATA_DIR}/${pair}.sqlite`, { readonly: true });
  const statements = countStatements(client);
  const db = drizzle({ client, schema }) as DictionaryDb;
  const language = readPairLanguage(pair);
  // Built before the first lookup, as the server builds them at startup,
  // so no lookup's cost includes them.
  await loadAnalyzer(language);
  phraseIndex(db, language);
  const rules = compoundRules(language);
  if (rules !== undefined) warmCompounds(db, rules);
  const ms: Array<number> = [];
  const sql: Array<number> = [];
  const timed = (word: string, context?: string, at?: number): LookupResult => {
    const before = statements();
    const start = performance.now();
    const result = lookupWord(db, language, word, context, at);
    ms.push(performance.now() - start);
    sql.push(statements() - before);
    return result;
  };
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
          r: timed(word, context, at),
        });
        if (!plain.has(word)) {
          plain.add(word);
          lines.push({ word, r: timed(word) });
        }
      }
    }
  }
  return { lines, cost: costOf(ms, sql) };
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

const { lines, cost } = await dump();
mkdirSync(out, { recursive: true });
writeFileSync(
  fileOf(values.run),
  lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
);
writeFileSync(costFileOf(values.run), JSON.stringify(cost, null, 2) + "\n");
console.log(`${lines.length} lookups -> ${fileOf(values.run)}`);
console.log("protocol problems:", problems(lines));
console.log(`cost per lookup: ${describeCost(cost)}`);

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
  const baseCost = costFileOf(values.base);
  if (existsSync(baseCost)) {
    const before = JSON.parse(readFileSync(baseCost, "utf8")) as Cost;
    const change = (from: number, to: number) =>
      `${from} -> ${to} (${to >= from ? "+" : ""}${Math.round(((to - from) / Math.max(from, 0.001)) * 100)}%)`;
    console.log(
      `cost against ${values.base}: ms mean ${change(before.ms.mean, cost.ms.mean)}, p99 ${change(before.ms.p99, cost.ms.p99)}; SQL mean ${change(before.sql.mean, cost.sql.mean)}`,
    );
  } else {
    console.log(`no cost saved for ${values.base}: run it again to compare`);
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
