import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Language } from "@dict/core/language";

/**
 * A morphological analyzer (Lindera, compiled to WebAssembly, with its
 * dictionary inside), for scripts without spaces: it cuts a sentence into
 * morphemes and gives each its part of speech and base form. A language names
 * its dictionary in `context.analyzer`. Each dictionary is loaded once, when
 * the server opens the language (`loadAnalyzer`), and stays loaded: UniDic
 * takes about a second and 600 MB.
 */

export type Morpheme = {
  readonly surface: string;
  /** Where it starts and ends in the text, as UTF-16 indexes. */
  readonly start: number;
  readonly end: number;
  /** Its part-of-speech tags joined with `-`, unset tags left out (`動詞-非自立可能`). */
  readonly pos: string;
  /** Its base forms, from the language's `baseFields`, in that order, without repeats. */
  readonly bases: ReadonlyArray<string>;
  /**
   * The surface, then as spelled by each later base form where it differs
   * from the first only in its head: `しれ` is also `知れ` (base `しれる`,
   * lemma `知れる`), so phrases written either way are found.
   */
  readonly spellings: ReadonlyArray<string>;
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

/** `pos` is one of `tags` or starts with one and a `-`. */
const hasPos = (pos: string, tags: ReadonlyArray<string>): boolean =>
  tags.some((tag) => pos === tag || pos.startsWith(`${tag}-`));

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

/** The npm package that holds each dictionary. Only installed ones load. */
const PACKAGES: Record<AnalyzerSettings["dictionary"], string> = {
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

const tokenizerFor = (dictionary: AnalyzerSettings["dictionary"]) => {
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

/**
 * Loads the language's analyzer dictionary now, so no lookup waits for it
 * (every request would, since lookups are synchronous). Throws when its
 * package can't be loaded.
 */
export const loadAnalyzer = (language: Language): void => {
  const settings = language.context.analyzer;
  if (settings !== undefined) tokenizerFor(settings.dictionary);
};

const analyzers = new WeakMap<Language, Analyzer>();

/** The language's analyzer, or undefined when it names none. */
export const analyzerFor = (language: Language): Analyzer | undefined => {
  const settings = language.context.analyzer;
  if (settings === undefined) return undefined;
  const cached = analyzers.get(language);
  if (cached !== undefined) return cached;
  const tokenize: Analyzer = (text) => {
    const tokenizer = tokenizerFor(settings.dictionary);
    const offsets = utf16At(text);
    const morphemes = tokenizer.tokenize(text).map((token) => {
      const { details } = token;
      const bases = [
        ...new Set(
          settings.baseFields
            .map((field) => details[field]?.split("-")[0] ?? "")
            .filter((base) => base !== "" && base !== "*"),
        ),
      ];
      const reading =
        settings.readingField === undefined
          ? undefined
          : details[settings.readingField];
      const morpheme: Morpheme = {
        ...(reading !== undefined && reading !== "" && reading !== "*"
          ? { reading }
          : {}),
        surface: token.surface,
        start: offsets.get(token.byte_start) ?? 0,
        end: offsets.get(token.byte_end) ?? text.length,
        pos: details
          .slice(0, 4)
          .filter((tag) => tag !== "*" && tag !== "")
          .join("-"),
        // A UniDic lemma may carry a gloss for loanwords (`ダイヤ-diagram`).
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
      token.free();
      return morpheme;
    });
    return reread(morphemes, settings.reread);
  };
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
  analyzers.set(language, analyze);
  return analyze;
};

/**
 * How much analyzed text each language keeps. An analysis takes about 200
 * bytes of memory per character (measured on Japanese with UniDic), so
 * 64k characters stay under about 13 MB, however long the sentences: about
 * 1,300 sentences of average length, against the few a lookup needs.
 */
const RECENT_CHARS = 64_000;
