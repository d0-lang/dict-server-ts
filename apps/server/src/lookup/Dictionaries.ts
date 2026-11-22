import { Context, Effect, Layer } from "effect";
import { AppConfig, DATA_DIR } from "../config.ts";
import { compoundRules } from "./features/compounds/split.ts";
import { phraseIndex } from "./features/phrases/phraseIndex.ts";
import { openDictionary, type DictionaryDb } from "@dict/core/DictionaryDb";
import { pairLanguage, type Language } from "@dict/core/language";
import { lookupWord } from "./lookup.ts";
import { warmCompounds } from "./features/compounds/stems.ts";
import type { LabelExplanation } from "@dict/core/labels";
import type { LookupBody } from "../domain/schemas.ts";
import { pairLabels } from "./labels.ts";
import { loadAnalyzer } from "./common/analyzer.ts";

/** The dictionary files of the language pairs this server lists. */
export class Dictionaries extends Context.Service<
  Dictionaries,
  {
    /**
     * `context` is the sentence around `word`, when the client sent one, and
     * `at` which copy of `word` in it was clicked.
     */
    readonly lookup: (
      pair: string,
      word: string,
      context?: string,
      at?: number,
    ) => LookupBody;
    /** What the pair's labels mean (`/v1/get-labels`); undefined for a pair it doesn't serve. */
    readonly labels: (
      pair: string,
    ) => Readonly<Record<string, LabelExplanation>> | undefined;
  }
>()("server/dictionary/Dictionaries") {
  /**
   * Opens `<dir>/<pair>.sqlite` for each listed pair, with the source
   * language's record (`languages/<lang>/language.toml`, defaults when there
   * is none); a missing file or an invalid record is fatal.
   * With `context` on, the phrase index is built here, not on the first lookup.
   * So are the label explanations, and an invalid labels file is fatal too.
   * The language's analyzer loads here as well, and one that can't is fatal.
   */
  static readonly layer = (dir = DATA_DIR) =>
    Layer.effect(
      Dictionaries,
      Effect.gen(function* () {
        const { languages, context } = yield* AppConfig;
        const files = new Map<
          string,
          {
            readonly db: DictionaryDb;
            readonly language: Language;
            readonly labels: Readonly<Record<string, LabelExplanation>>;
          }
        >();
        for (const pair of languages) {
          const db = yield* openDictionary(`${dir}/${pair}.sqlite`);
          const language = yield* pairLanguage(pair);
          yield* Effect.tryPromise({
            try: () => loadAnalyzer(language),
            catch: (cause) =>
              new Error(`analyzer of ${pair}: ${String(cause)}`, { cause }),
          });
          if (context) phraseIndex(db, language);
          const rules = compoundRules(language);
          if (rules !== undefined) warmCompounds(db, rules);
          const labels = yield* Effect.try({
            try: () => pairLabels(db, language),
            catch: (cause) =>
              new Error(`labels of ${pair}: ${String(cause)}`, { cause }),
          });
          files.set(pair, { db, language, labels });
          // Building the indexes leaves garbage that Bun doesn't collect
          // while startup runs on: with every pair it held up to 3 GB
          // before listening, against about 1 GB after.
          Bun.gc(true);
        }
        return Dictionaries.of({
          lookup: (pair, word, sentence, at) => {
            const file = files.get(pair);
            return file === undefined
              ? { entries: [] }
              : lookupWord(file.db, file.language, word, sentence, at);
          },
          labels: (pair) => files.get(pair)?.labels,
        });
      }),
    ).pipe(Layer.orDie);
}
