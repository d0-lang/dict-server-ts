/**
 * Runs the context benchmark: every verified case in `eval/gold/<lang>/context.jsonl`
 * goes through the real lookup, with its sentence as `context`, against the
 * real dictionary file. No server and no LLM are involved.
 *
 *   bun eval/context-bench.ts --lang ru --run base
 *   bun eval/context-bench.ts --lang ru --run iter1 --base base
 *
 * A positive (`expect: "phrase"`) passes when an entry for `lemma` comes before
 * the clicked word's own entries. A negative passes when no entry for `lemma`
 * appears at all. Results go to `eval/out/<lang>/bench/<run>/`: `scores.json`
 * per type and variant, `cases.jsonl` per case, and `flips.json` against
 * `--base` (by default the newest earlier run).
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { DictionaryDb } from "../src/dictionary/DictionaryDb.ts";
import { lookupWord } from "../src/dictionary/lookup.ts";
import { lookupKey } from "../src/dictionary/lookupKey.ts";
import { SCHEMA_VERSION, schema } from "../src/dictionary/schema.ts";

export type ContextCase = {
  readonly id: string;
  readonly type: string;
  readonly variant: string;
  readonly lemma: string;
  readonly sentence: string;
  readonly word: string;
  readonly expect: "phrase" | "not-phrase";
  readonly gloss?: string;
  readonly source: "generated" | "wiktionary";
};

export type CaseResult = {
  readonly id: string;
  readonly type: string;
  readonly variant: string;
  readonly expect: ContextCase["expect"];
  readonly pass: boolean;
  /** Position of the first `lemma` entry in the result, or -1. */
  readonly rank: number;
  /** Lemmas of the first three entries, to read failures without rerunning. */
  readonly top: ReadonlyArray<string>;
};

type Score = { positives: number; recall: number; negatives: number; falsePositives: number };

const openDb = (path: string): DictionaryDb => {
  const client = new Database(path, { readonly: true, strict: true });
  const version = client.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
  if (version !== SCHEMA_VERSION) throw new Error(`${path}: schema ${version}, expected ${SCHEMA_VERSION}`);
  return Object.assign(drizzle({ client, schema }), { $client: client }) as DictionaryDb;
};

/** Runs one case; exported so a test can check the pass rule on a tiny dictionary. */
/**
 * The word the client sends for a click on `c.word`: the segment of the
 * sentence containing it, as the extension's `tokensAt` takes it. Usually
 * `c.word` itself, but the segmenter keeps letters joined by periods together,
 * so clicking `т` in `и т.д.` sends `т.д`.
 */
export const clickedWord = (c: ContextCase, lang: string): string => {
  const escaped = c.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = c.sentence.search(
    new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "iu"),
  );
  if (at < 0) return c.word;
  const segment = new Intl.Segmenter(lang, { granularity: "word" })
    .segment(c.sentence)
    .containing(at);
  return segment?.isWordLike === true ? segment.segment : c.word;
};

/** An abbreviation is one lemma with or without spaces after its periods (`п.п.`, `п. п.`). */
const lemmaKey = (lemma: string) => lookupKey(lemma).replace(/\.\s+/g, ".");

export const runCase = (db: DictionaryDb, pair: string, c: ContextCase): CaseResult => {
  const target = lemmaKey(c.lemma);
  const isTarget = (lemma: string) => lemmaKey(lemma) === target;
  const word = clickedWord(c, pair.split("_")[0]!);
  const withContext = lookupWord(db, pair, word, c.sentence).entries;
  const own = lookupWord(db, pair, word).entries.filter((e) => !isTarget(e.lemma));
  const ownIds = new Set(own.map((e) => JSON.stringify([e.lemma, e.pos, e.senses])));
  const rank = withContext.findIndex((e) => isTarget(e.lemma));
  const firstOwn = withContext.findIndex((e) => ownIds.has(JSON.stringify([e.lemma, e.pos, e.senses])));
  const pass =
    c.expect === "phrase" ? rank >= 0 && (firstOwn < 0 || rank < firstOwn) : rank < 0;
  return {
    id: c.id,
    type: c.type,
    variant: c.variant,
    expect: c.expect,
    pass,
    rank,
    top: withContext.slice(0, 3).map((e) => e.lemma),
  };
};

const score = (results: ReadonlyArray<CaseResult>): Score => {
  const pos = results.filter((r) => r.expect === "phrase");
  const neg = results.filter((r) => r.expect === "not-phrase");
  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);
  return {
    positives: pos.length,
    recall: pct(pos.filter((r) => r.pass).length, pos.length),
    negatives: neg.length,
    falsePositives: pct(neg.filter((r) => !r.pass).length, neg.length),
  };
};

const groupBy = <T>(xs: ReadonlyArray<T>, key: (x: T) => string) => {
  const m = new Map<string, Array<T>>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m].sort(([a], [b]) => a.localeCompare(b));
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      lang: { type: "string" },
      run: { type: "string" },
      base: { type: "string" },
      gold: { type: "string" },
      db: { type: "string" },
    },
  });
  if (!values.lang || !values.run) throw new Error("Usage: context-bench --lang <lang> --run <name> [--base <run>]");
  const lang = values.lang;
  const pair = `${lang}_en`;
  const gold = values.gold ?? `eval/gold/${lang}/context.jsonl`;
  const cases: Array<ContextCase> = readFileSync(gold, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
  const db = openDb(values.db ?? `data/${pair}.sqlite`);
  const results = cases.map((c) => runCase(db, pair, c));

  const benchDir = `eval/out/${lang}/bench`;
  const outDir = join(benchDir, values.run);
  mkdirSync(outDir, { recursive: true });
  const scores = {
    all: score(results),
    byType: Object.fromEntries(groupBy(results, (r) => r.type).map(([k, rs]) => [k, score(rs)])),
    byVariant: Object.fromEntries(
      groupBy(results, (r) => `${r.type}/${r.variant}`).map(([k, rs]) => [k, score(rs)]),
    ),
  };
  writeFileSync(join(outDir, "scores.json"), JSON.stringify(scores, null, 2));
  writeFileSync(join(outDir, "cases.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // The base run: named, or the newest other run that has cases.
  const others = existsSync(benchDir)
    ? readdirSync(benchDir)
        .filter((d) => d !== values.run && existsSync(join(benchDir, d, "cases.jsonl")))
        .sort((a, b) => statSync(join(benchDir, b)).mtimeMs - statSync(join(benchDir, a)).mtimeMs)
    : [];
  const base = values.base ?? others[0];
  let flips: { base: string; fixed: Array<string>; broken: Array<string> } | undefined;
  if (base !== undefined) {
    const before = new Map<string, boolean>(
      readFileSync(join(benchDir, base, "cases.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const r = JSON.parse(line) as CaseResult;
          return [r.id, r.pass];
        }),
    );
    flips = {
      base,
      fixed: results.filter((r) => before.get(r.id) === false && r.pass).map((r) => r.id),
      broken: results.filter((r) => before.get(r.id) === true && !r.pass).map((r) => r.id),
    };
    writeFileSync(join(outDir, "flips.json"), JSON.stringify(flips, null, 2));
  }

  const row = (name: string, s: Score) =>
    `${name.padEnd(28)} ${String(s.positives).padStart(4)} pos  recall ${String(s.recall).padStart(5)}%   ${String(s.negatives).padStart(4)} neg  FP ${String(s.falsePositives).padStart(5)}%`;
  console.log(row("all", scores.all));
  for (const [k, s] of Object.entries(scores.byType)) console.log(row(k, s));
  console.log("");
  for (const [k, s] of Object.entries(scores.byVariant)) console.log(row(k, s));
  if (flips) console.log(`\nagainst ${flips.base}: ${flips.fixed.length} fixed, ${flips.broken.length} broken`, flips.broken.slice(0, 20));
}
