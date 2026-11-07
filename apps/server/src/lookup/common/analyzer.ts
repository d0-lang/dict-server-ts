import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Language } from "@dict/core/language";

/**
 * A morphological analyzer (Lindera, compiled to WebAssembly, with its
 * dictionary inside), for scripts without spaces: it cuts a sentence into
 * morphemes and gives each its part of speech and base form. A language names
 * its dictionary in `context.analyzer`. Each dictionary is loaded once, on
 * first use, and stays loaded: UniDic takes about a second and 600 MB.
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

const analyzers = new WeakMap<Language, Analyzer>();

/** The language's analyzer, or undefined when it names none. */
export const analyzerFor = (language: Language): Analyzer | undefined => {
  const settings = language.context.analyzer;
  if (settings === undefined) return undefined;
  const cached = analyzers.get(language);
  if (cached !== undefined) return cached;
  const analyze: Analyzer = (text) => {
    const tokenizer = tokenizerFor(settings.dictionary);
    const offsets = utf16At(text);
    return tokenizer.tokenize(text).map((token) => {
      const { details } = token;
      const bases = [
        ...new Set(
          settings.baseFields
            .map((field) => details[field]?.split("-")[0] ?? "")
            .filter((base) => base !== "" && base !== "*"),
        ),
      ];
      const morpheme: Morpheme = {
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
  };
  analyzers.set(language, analyze);
  return analyze;
};
