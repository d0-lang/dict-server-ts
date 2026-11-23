import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";

/**
 * A morphological analyzer (Lindera, compiled to WebAssembly, with its
 * dictionary inside), for scripts without spaces: it cuts a sentence into
 * morphemes and gives each its part of speech and base form. A language names
 * its dictionary in `context.analyzer`. Each dictionary is loaded once, when
 * the server opens the language (`loadAnalyzer`), and stays loaded: UniDic
 * takes about a second and 600 MB. `words` is no analyzer of its own but the
 * dictionary's words (`wordPieces`), for a script whose words don't inflect.
 */

export type Morpheme = {
  readonly surface: string;
  /** Where it starts and ends in the text, as UTF-16 indexes. */
  readonly start: number;
  readonly end: number;
  /**
   * Its part-of-speech tags joined with `-`, unset tags left out
   * (`動詞-非自立可能`); a fused morpheme's parts' joined with `+` (Kiwi's
   * `VV+EP`, `했`).
   */
  readonly pos: string;
  /**
   * Its base forms, from the language's `baseFields` (Kiwi's: of each of a
   * fused morpheme's parts), spelled as `baseSpellings` says, in that order,
   * without repeats.
   */
  readonly bases: ReadonlyArray<string>;
  /**
   * The surface, then as spelled by each later base form where it differs
   * from the first only in its head: `しれ` is also `知れ` (base `しれる`,
   * lemma `知れる`), so phrases written either way are found.
   */
  readonly spellings: ReadonlyArray<string>;
  /**
   * A `baseSpellings` rule spelled its base forms: the dictionary writes it
   * otherwise than the text (`에서` is `-에서`; `에서` alone is "Esau").
   */
  readonly respelled?: boolean;
  /** Its lemma's reading, from the language's `readingField` (`ニン` for `人` the counter), when the dictionary gives one. */
  readonly reading?: string;
};

/** `surface` spelled the way `other` spells what `base` spells (`しれ`, `しれる`, `知れる` -> `知れ`). */
const respell = (
  surface: string,
  base: string,
  other: string,
): string | undefined => {
  let common = 0;
  while (
    common < base.length &&
    common < other.length &&
    base[base.length - 1 - common] === other[other.length - 1 - common]
  ) {
    common++;
  }
  const head = base.slice(0, base.length - common);
  const otherHead = other.slice(0, other.length - common);
  return head !== "" && head !== otherHead && surface.startsWith(head)
    ? otherHead + surface.slice(head.length)
    : undefined;
};

export type Analyzer = (text: string) => ReadonlyArray<Morpheme>;

type AnalyzerSettings = NonNullable<Language["context"]["analyzer"]>;

/**
 * `pos` is one of `tags` or starts with one and a `-`. A fused morpheme's
 * tags (`VV+EP`) are each of its parts', so it is any of them.
 */
export const hasPos = (pos: string, tags: ReadonlyArray<string>): boolean =>
  pos
    .split("+")
    .some((part) =>
      tags.some((tag) => part === tag || part.startsWith(`${tag}-`)),
    );

/**
 * A Lindera morpheme's base forms, from `baseFields`, each with the part of
 * speech it is the base of. UniDic's lemma may carry a gloss for loanwords
 * (`ダイヤ-diagram`).
 */
const linderaBases = (
  details: ReadonlyArray<string>,
  pos: string,
  settings: AnalyzerSettings,
): ReadonlyArray<{ readonly base: string; readonly pos: string }> =>
  settings.baseFields
    .map((field) => details[field]?.split("-")[0] ?? "")
    .filter((base) => base !== "" && base !== "*")
    .map((base) => ({ base, pos }));

/**
 * A fused morpheme's parts, stems before the particles and endings fused
 * onto them (`baseSpellings`' `affix`): `걸` is `거` (`것`) + `ㄹ`, `했` is
 * `하` + `았`.
 */
const stemsFirst = (
  parts: ReadonlyArray<{ readonly base: string; readonly pos: string }>,
  settings: AnalyzerSettings,
): ReadonlyArray<{ readonly base: string; readonly pos: string }> => {
  const affix = (part: { readonly pos: string }) =>
    settings.baseSpellings.find((rule) => hasPos(part.pos, rule.pos))?.affix ===
    true;
  return [...parts.filter((part) => !affix(part)), ...parts.filter(affix)];
};

/** Each base form as the dictionary spells it (`baseLetters`, `baseSpellings`): `먹` (`VV`) is `먹다`, `에서` (`JKB`) is `-에서`. */
const spelledBases = (
  raw: ReadonlyArray<{ readonly base: string; readonly pos: string }>,
  settings: AnalyzerSettings,
): ReadonlyArray<string> => {
  const letters = Object.entries(settings.baseLetters);
  return [
    ...new Set(
      raw.flatMap(({ base, pos }) => {
        const written = letters.reduce(
          (text, [from, to]) => text.replaceAll(from, to),
          base,
        );
        const rule = settings.baseSpellings.find((r) => hasPos(pos, r.pos));
        return rule === undefined
          ? [written]
          : rule.spellings.map((spelling) => spelling.replace("*", written));
      }),
    ),
  ];
};

/**
 * The morphemes with the `reread` rules applied, from the first on: a rule's
 * `after` sees the morpheme before as already reread. A reread morpheme
 * keeps only its surface as spelling, and no reading: the analyzer's was for
 * the word it took it for.
 */
export const reread = (
  morphemes: ReadonlyArray<Morpheme>,
  rules: AnalyzerSettings["reread"],
): ReadonlyArray<Morpheme> => {
  if (rules.length === 0) return morphemes;
  const out: Array<Morpheme> = [];
  morphemes.forEach((morpheme, i) => {
    const before = out.at(-1);
    const next = morphemes[i + 1];
    const rule = rules.find(
      (r) =>
        hasPos(morpheme.pos, r.pos) &&
        (r.surface === undefined || r.surface.includes(morpheme.surface)) &&
        (r.after === undefined ||
          (before !== undefined && hasPos(before.pos, r.after))) &&
        (r.before === undefined ||
          (next !== undefined && hasPos(next.pos, r.before))),
    );
    if (rule === undefined) {
      out.push(morpheme);
      return;
    }
    const { reading: _, ...rest } = morpheme;
    out.push({
      ...rest,
      pos: rule.as.pos,
      bases: rule.as.base === undefined ? morpheme.bases : [rule.as.base],
      spellings: [morpheme.surface],
    });
  });
  return out;
};

/** The npm package that holds each Lindera dictionary. Only installed ones load. */
const PACKAGES: Record<
  Exclude<AnalyzerSettings["dictionary"], "kiwi" | "words">,
  string
> = {
  unidic: "lindera-wasm-unidic",
  ipadic: "lindera-wasm-ipadic",
  "ko-dic": "lindera-wasm-ko-dic",
  "cc-cedict": "lindera-wasm-cc-cedict",
};

type Lindera = {
  readonly initSync: (module: { module: Uint8Array }) => unknown;
  readonly TokenizerBuilder: new () => {
    setDictionary(uri: string): void;
    setMode(mode: string): void;
    build(): {
      tokenize(text: string): Array<{
        readonly surface: string;
        readonly byte_start: number;
        readonly byte_end: number;
        readonly details: ReadonlyArray<string>;
        free(): void;
      }>;
    };
  };
};

const require = createRequire(import.meta.url);
const tokenizers = new Map<
  string,
  ReturnType<InstanceType<Lindera["TokenizerBuilder"]>["build"]>
>();

const tokenizerFor = (dictionary: keyof typeof PACKAGES) => {
  const cached = tokenizers.get(dictionary);
  if (cached !== undefined) return cached;
  const name = PACKAGES[dictionary];
  const lindera = require(name) as Lindera;
  const file = name.replace(/-/g, "_");
  lindera.initSync({
    module: readFileSync(require.resolve(`${name}/${file}_bg.wasm`)),
  });
  const builder = new lindera.TokenizerBuilder();
  builder.setDictionary(`embedded://${dictionary}`);
  builder.setMode("normal");
  const tokenizer = builder.build();
  tokenizers.set(dictionary, tokenizer);
  return tokenizer;
};

/** UTF-16 index of every UTF-8 byte offset of `text` that starts a character, and of its end. */
const utf16At = (text: string): Map<number, number> => {
  const at = new Map<number, number>();
  let bytes = 0;
  let index = 0;
  for (const ch of text) {
    at.set(bytes, index);
    const code = ch.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    index += ch.length;
  }
  at.set(bytes, index);
  return at;
};

/** A token of Kiwi's analysis: its base form (`듣` for `들`), tag, and UTF-16 span. */
type KiwiToken = {
  readonly str: string;
  readonly tag: string;
  readonly position: number;
  readonly length: number;
};

type Kiwi = { readonly tokenize: (text: string) => ReadonlyArray<KiwiToken> };

/**
 * Where Kiwi's model files are (`bun run kiwi:model` fetches them there):
 * `KIWI_MODEL_DIR`, else `models/kiwi` under the working directory.
 */
const kiwiModelDir = (): string =>
  process.env["KIWI_MODEL_DIR"]?.trim() || "models/kiwi";

const KIWI_FILES = [
  "combiningRule.txt",
  "cong.mdl",
  "contraction.dict",
  "default.dict",
  "dialect.dict",
  "extract.mdl",
  "multi.dict",
  "nounchr.mdl",
  "sj.morph",
  "typo.dict",
];

let kiwi: Kiwi | undefined;
let kiwiLoading: Promise<Kiwi> | undefined;

/** Kiwi with its model, built once. Its WebAssembly loads asynchronously; lookups then tokenize synchronously. */
const loadKiwi = (): Promise<Kiwi> => {
  kiwiLoading ??= (async () => {
    const { KiwiBuilder } = (await import("kiwi-nlp")) as unknown as {
      readonly KiwiBuilder: {
        create(wasmPath: string): Promise<{
          build(args: Record<string, unknown>): Promise<Kiwi>;
        }>;
      };
    };
    const wasm = join(dirname(require.resolve("kiwi-nlp")), "kiwi-wasm.wasm");
    const builder = await KiwiBuilder.create(wasm);
    const dir = kiwiModelDir();
    const modelFiles = Object.fromEntries(
      KIWI_FILES.map((file) => [
        file,
        new Uint8Array(readFileSync(join(dir, file))),
      ]),
    );
    // No multi-word dictionary: its entries span spaces (백일의 낭군님, a
    // drama's title, as one noun), and a word here ends at a space.
    kiwi = await builder.build({
      modelFiles,
      modelType: "cong",
      loadMultiDict: false,
    });
    return kiwi;
  })();
  return kiwiLoading;
};

/**
 * Loads the language's analyzer now, so no lookup waits for it (every
 * request would, since lookups are synchronous). Rejects when its package
 * or model can't be loaded.
 */
export const loadAnalyzer = async (language: Language): Promise<void> => {
  const settings = language.context.analyzer;
  if (settings === undefined) return;
  if (settings.dictionary === "kiwi") await loadKiwi();
  else if (settings.dictionary !== "words") tokenizerFor(settings.dictionary);
};

/**
 * A run of text the analyzer read as one piece, with what it is made of:
 * Lindera's token, or Kiwi's tokens that share a span (`했` is `하` + `었`).
 */
type Piece = {
  readonly surface: string;
  readonly start: number;
  readonly end: number;
  readonly pos: string;
  readonly parts: ReadonlyArray<{
    readonly base: string;
    readonly pos: string;
  }>;
  readonly reading?: string;
};

/**
 * Kiwi's tokens as pieces of the text: tokens whose spans overlap are one
 * piece, written as the text writes it (`했`: `하` and `었` at one place;
 * `갈`: `가` and `ᆯ`), its tag the parts' joined with `+`.
 */
const kiwiPieces = (text: string, from: number): ReadonlyArray<Piece> => {
  if (kiwi === undefined) {
    throw new Error("Kiwi is not loaded: call loadAnalyzer first");
  }
  const groups: Array<{ start: number; end: number; tokens: KiwiToken[] }> = [];
  for (const token of kiwi.tokenize(text)) {
    const start = token.position;
    const end = token.position + token.length;
    const last = groups.at(-1);
    // Overlapping tokens are one piece, and so is a token with no span of
    // its own and the one after it: Kiwi gives the copula in 냄새야 as `이`
    // of length 0 before `야`.
    if (
      last !== undefined &&
      (start < last.end || end <= last.start || last.start === last.end)
    ) {
      last.end = Math.max(last.end, end);
      last.tokens.push(token);
    } else {
      groups.push({ start, end, tokens: [token] });
    }
  }
  return groups.map(({ start, end, tokens }) => ({
    surface: text.slice(start, end),
    start: from + start,
    end: from + end,
    pos: tokens.map((token) => token.tag).join("+"),
    parts: tokens.map((token) => ({ base: token.str, pos: token.tag })),
  }));
};

/** The longest word `wordPieces` looks for, in letters: chengyu have 4, most set phrases fewer than 8. */
const MAX_WORD = 8;

/** The tags of `wordPieces`: a letter that starts a dictionary word, and one inside it. */
export const WORD_START = "B";
export const WORD_INSIDE = "I";

/**
 * The text cut into the dictionary's own words (`dictionary = "words"`), for a
 * script without spaces whose words don't inflect (Chinese), where an
 * analyzer's dictionary would only be a second word list beside this one.
 * Each run of Han letters is cut into the fewest words with an entry, a
 * single letter always counting as one. On a tie, the cut with the fewest
 * letters standing alone that have no grammar-file line wins (`城市|里`, not
 * `城|市里`: `里` "in" is a word by itself, `城` alone is a letter), then the
 * one whose last word is longer (reverse maximum matching: `研究生命` is
 * `研究|生命`, not `研究生|命`). Measured on the corpus's reference words:
 * 82.8% of words, against 82.0% for the last word alone. Each letter is a piece, tagged `WORD_START` where a word
 * starts and `WORD_INSIDE` inside one, so a `join` rule makes the words of
 * them and a word's letters are its parts (`手|机`). A run of other letters or
 * digits is one piece (`iPhone`, `18`), with no tag, and so is each other
 * character.
 */
const wordPieces = (
  db: DictionaryDb,
  text: string,
  from: number,
): ReadonlyArray<Piece> => {
  const known = db.$client.query<{ found: number }, [string]>(
    `SELECT 1 AS found FROM forms WHERE form = ?1 AND source <> ${FormSource.Abbreviation} LIMIT 1`,
  );
  const isWord = (word: string) => known.get(lookupKey(word)) !== null;
  // A letter with a grammar-file line is a word by itself (`的`, `了`, `里`).
  const line = db.$client.query<{ found: number }, [string]>(
    `SELECT 1 AS found FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ?1 AND e.source_pos = '${GRAMMAR_SOURCE_POS}' LIMIT 1`,
  );
  const loose = (letter: string) =>
    line.get(lookupKey(letter)) === null ? 1 : 0;
  const pieces: Array<Piece> = [];
  const add = (start: number, end: number, pos = "") => {
    const surface = text.slice(start, end);
    pieces.push({
      surface,
      start: from + start,
      end: from + end,
      pos,
      parts: [{ base: surface, pos }],
    });
  };
  // Letters or digits of other scripts stop at a Han letter (`10|天`).
  const runs =
    /([\p{Script=Han}〇]+)|((?:(?![\p{Script=Han}〇])[\p{L}\p{M}\p{N}])+)|(\S)/gu;
  for (const run of text.matchAll(runs)) {
    const start = run.index;
    if (run[1] === undefined) {
      add(start, start + run[0].length);
      continue;
    }
    // Letters, not UTF-16 units: a rare character outside the BMP is one.
    const letters = [...run[1]];
    const at = [0];
    for (const letter of letters) at.push(at.at(-1)! + letter.length);
    const fewest = [0];
    const alone = [0];
    const last = [0];
    for (let end = 1; end <= letters.length; end++) {
      fewest.push(Number.POSITIVE_INFINITY);
      alone.push(Number.POSITIVE_INFINITY);
      last.push(0);
      for (let size = 1; size <= Math.min(MAX_WORD, end); size++) {
        const word = run[1].slice(at[end - size], at[end]);
        if (size > 1 && !isWord(word)) continue;
        const count = fewest[end - size]! + 1;
        const lone = alone[end - size]! + (size === 1 ? loose(word) : 0);
        if (
          count < fewest[end]! ||
          (count === fewest[end] &&
            (lone < alone[end]! || (lone === alone[end] && size > last[end]!)))
        ) {
          fewest[end] = count;
          alone[end] = lone;
          last[end] = size;
        }
      }
    }
    const cuts: Array<number> = [];
    for (let end = letters.length; end > 0; end -= last[end]!) cuts.push(end);
    let begin = 0;
    for (const end of cuts.reverse()) {
      for (let letter = begin; letter < end; letter++) {
        add(
          start + at[letter]!,
          start + at[letter + 1]!,
          letter === begin ? WORD_START : WORD_INSIDE,
        );
      }
      begin = end;
    }
  }
  return pieces;
};

/** By dictionary: `words` reads it, and a file is one language's. */
const analyzers = new WeakMap<DictionaryDb, Analyzer>();

/**
 * The language's analyzer, or undefined when it names none. `words` reads the
 * dictionary `db`, the language's own.
 */
export const analyzerFor = (
  language: Language,
  db: DictionaryDb,
): Analyzer | undefined => {
  const settings = language.context.analyzer;
  if (settings === undefined) return undefined;
  const cached = analyzers.get(db);
  if (cached !== undefined) return cached;
  const tokenize: Analyzer = (text) =>
    reread(morphemesOf(text, 0), settings.reread);
  const linderaPieces = (text: string, from: number): ReadonlyArray<Piece> => {
    const tokenizer = tokenizerFor(
      settings.dictionary as keyof typeof PACKAGES,
    );
    const offsets = utf16At(text);
    return tokenizer.tokenize(text).map((token) => {
      const { details } = token;
      const pos = details
        .slice(0, 4)
        .filter((tag) => tag !== "*" && tag !== "")
        .join("-");
      const reading =
        settings.readingField === undefined
          ? undefined
          : details[settings.readingField];
      const piece: Piece = {
        ...(reading !== undefined && reading !== "" && reading !== "*"
          ? { reading }
          : {}),
        surface: token.surface,
        start: from + (offsets.get(token.byte_start) ?? 0),
        end: from + (offsets.get(token.byte_end) ?? text.length),
        pos,
        parts: linderaBases(details, pos, settings),
      };
      token.free();
      return piece;
    });
  };
  const morphemesOf = (text: string, from: number): ReadonlyArray<Morpheme> =>
    (settings.dictionary === "kiwi"
      ? kiwiPieces(text, from)
      : settings.dictionary === "words"
        ? wordPieces(db, text, from)
        : linderaPieces(text, from)
    ).map((token) => {
      const raw = stemsFirst(token.parts, settings);
      const bases = spelledBases(raw, settings);
      const respelled = raw.some(({ pos }) =>
        settings.baseSpellings.some((rule) => hasPos(pos, rule.pos)),
      );
      const { reading } = token;
      const morpheme: Morpheme = {
        ...(reading !== undefined ? { reading } : {}),
        ...(respelled ? { respelled } : {}),
        surface: token.surface,
        start: token.start,
        end: token.end,
        pos: token.pos,
        bases,
        spellings: [
          ...new Set([
            token.surface,
            ...bases
              .slice(1)
              .flatMap(
                (other) => respell(token.surface, bases[0]!, other) ?? [],
              ),
          ]),
        ],
      };
      return morpheme;
    });
  // The same sentence is analyzed again for each word clicked in it (a
  // reader clicks several; a corpus collection sends every word), and one
  // lookup analyzes it, and the lemmas it finds, several times: the most
  // recent analyses are kept, up to `RECENT_CHARS` characters of text.
  const recent = new Map<string, ReadonlyArray<Morpheme>>();
  let chars = 0;
  const analyze: Analyzer = (text) => {
    const cached = recent.get(text);
    if (cached !== undefined) {
      recent.delete(text);
      recent.set(text, cached);
      return cached;
    }
    const morphemes = tokenize(text);
    if (text.length > RECENT_CHARS) return morphemes;
    recent.set(text, morphemes);
    chars += text.length;
    for (const oldest of recent.keys()) {
      if (chars <= RECENT_CHARS) break;
      recent.delete(oldest);
      chars -= oldest.length;
    }
    return morphemes;
  };
  analyzers.set(db, analyze);
  return analyze;
};

/**
 * How much analyzed text each language keeps. An analysis takes about 200
 * bytes of memory per character (measured on Japanese with UniDic), so
 * 64k characters stay under about 13 MB, however long the sentences: about
 * 1,300 sentences of average length, against the few a lookup needs.
 */
const RECENT_CHARS = 64_000;
