/**
 * Runs the segments benchmark: words whose Wiktionary etymology says they are
 * a compound (`лес` + `-о-` + `насаждение`, `Kind` + `-er-` + `Garten`) are
 * split with their own entry set aside, and the parts are compared with the
 * etymology. No LLM is involved.
 *
 *   bun run bench:segments --lang ru --run base
 *
 * Only clean etymologies count: two whole words, optionally with a linking
 * element between them, no suffix and no shortened part. A split matches when
 * the first part reaches the first word (or a combining form of it, `нефте-`)
 * and the second part reaches the second. Results go to
 * `apps/server/eval/out/<lang>/bench/<run>/segments.json`.
 *
 * Every case has an entry of its own, which the lookup shows instead of a
 * split, so a missing split is no miss for readers. The headline number is
 * precision: how many of the splits made are right. Coverage (how many
 * split at all) only says how often the splitter would help a word that
 * lacks an entry.
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readPairLanguage, type Language } from "@dict/core/language";
import { compoundRules } from "../src/lookup/features/compounds/split.ts";
import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { lookupKey } from "@dict/core/lookupKey";
import { compoundEntries } from "../src/lookup/features/compounds/lookup.ts";
import { schema } from "@dict/core/schema";

export type SegmentCase = {
  readonly word: string;
  readonly first: string;
  readonly linker: string;
  readonly second: string;
};

export type SegmentOutcome =
  "exact" | "combining-form" | "linker-differs" | "wrong-parts" | "no-split";

/** Clean two-word compounds from `af`/`affix`/`compound` templates in a filtered dump. */
export const segmentCases = (
  jsonl: string,
  lang: string,
): ReadonlyArray<SegmentCase> => {
  const cases: Array<SegmentCase> = [];
  const seen = new Set<string>();
  for (const line of jsonl.split("\n")) {
    if (line === "") continue;
    const entry = JSON.parse(line) as {
      word: string;
      etymology_templates?: Array<{
        name: string;
        args: Record<string, string>;
      }>;
    };
    if (/[\s-]/.test(entry.word) || seen.has(entry.word)) continue;
    const template = entry.etymology_templates?.find((t) =>
      ["af", "affix", "compound", "com"].includes(t.name),
    );
    if (template === undefined || template.args["1"] !== lang) continue;
    // Shortened or respelled parts (`alt3`, `alt2`) don't spell what the word contains.
    if (Object.keys(template.args).some((k) => /^alt\d+$/.test(k))) continue;
    const parts = Object.entries(template.args)
      .filter(([k]) => /^\d+$/.test(k) && k !== "1")
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v.trim());
    const isLinker = (p: string) => /^-\p{L}{1,3}-$/u.test(p);
    const isWord = (p: string) =>
      p !== "" && !p.startsWith("-") && !p.endsWith("-");
    let first: string, second: string, linker: string;
    if (parts.length === 2 && isWord(parts[0]!) && isWord(parts[1]!)) {
      [first, second, linker] = [parts[0]!, parts[1]!, ""];
    } else if (
      parts.length === 3 &&
      isWord(parts[0]!) &&
      isLinker(parts[1]!) &&
      isWord(parts[2]!)
    ) {
      [first, linker, second] = [parts[0]!, parts[1]!.slice(1, -1), parts[2]!];
    } else continue;
    seen.add(entry.word);
    cases.push({
      word: entry.word,
      first: lookupKey(first),
      linker: lookupKey(linker),
      second: lookupKey(second),
    });
  }
  return cases;
};

/** How the split of `c.word` compares with its etymology. */
export const judgeSplit = (
  db: DictionaryDb,
  language: Language,
  c: SegmentCase,
): { outcome: SegmentOutcome; split: string } => {
  const rules = compoundRules(language) ?? { linkers: [] };
  const result = compoundEntries(db, c.word, rules);
  const segments = result.segments;
  if (segments === undefined || result.entries.length === 0)
    return { outcome: "no-split", split: "" };
  const parts = segments.filter((s) => s.entries !== undefined);
  const split = segments
    .map((s) => (s.entries === undefined ? `(${s.text})` : s.text))
    .join("|");
  if (parts.length !== 2) return { outcome: "wrong-parts", split };
  const lemmas = parts.map(
    (s) => new Set(s.entries!.map((i) => lookupKey(result.entries[i]!.lemma))),
  );
  const linker = segments.length === 3 ? lookupKey(segments[1]!.text) : "";
  const second = lemmas[1]!.has(c.second);
  if (lemmas[0]!.has(c.first) && second) {
    return { outcome: linker === c.linker ? "exact" : "linker-differs", split };
  }
  if (
    second &&
    lemmas[0]!.has(`${lookupKey(parts[0]!.text)}-`) &&
    `${c.first}`.length > 0
  ) {
    return { outcome: "combining-form", split };
  }
  return { outcome: "wrong-parts", split };
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      lang: { type: "string" },
      run: { type: "string" },
      sample: { type: "string" },
    },
  });
  if (!values.lang || !values.run)
    throw new Error("Usage: segments-bench --lang <lang> --run <name>");
  const lang = values.lang;
  const pair = `${lang}_en`;
  const client = new Database(`data/${pair}.sqlite`, {
    readonly: true,
    strict: true,
  });
  const db = Object.assign(drizzle({ client, schema }), {
    $client: client,
  }) as DictionaryDb;
  let cases = segmentCases(
    readFileSync(`data/raw/${lang}.jsonl`, "utf8"),
    lang,
  );
  if (values.sample !== undefined)
    cases = cases.slice(0, Number(values.sample));
  const language = readPairLanguage(pair);
  const results = cases.map((c) => ({ ...c, ...judgeSplit(db, language, c) }));
  const counts: Record<SegmentOutcome, number> = {
    exact: 0,
    "combining-form": 0,
    "linker-differs": 0,
    "wrong-parts": 0,
    "no-split": 0,
  };
  for (const r of results) counts[r.outcome]++;
  const pct = (n: number) =>
    Math.round((1000 * n) / Math.max(1, results.length)) / 10;
  const summary = Object.fromEntries(
    Object.entries(counts).map(([k, n]) => [k, { n, pct: pct(n) }]),
  );
  // Every case has an entry of its own (that's where its etymology comes
  // from), so in a real lookup it is never split, and a word without a split
  // just shows nothing extra. What hurts readers is a wrong split, so the
  // headline is precision: right parts among the words that split.
  const split = results.length - counts["no-split"];
  const right =
    counts.exact + counts["combining-form"] + counts["linker-differs"];
  const precision = Math.round((1000 * right) / Math.max(1, split)) / 10;
  const outDir = join(import.meta.dirname, "out", lang, "bench", values.run);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "segments.json"),
    JSON.stringify(
      { cases: results.length, precision, split, summary, results },
      null,
      2,
    ),
  );
  console.log(
    `${results.length} compounds, ${split} split; precision ${precision}% (right parts among splits)`,
  );
  for (const [k, { n, pct: p }] of Object.entries(summary))
    console.log(`${k.padEnd(16)} ${String(n).padStart(5)}  ${p}%`);
}
