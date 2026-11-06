import { Context, Effect, Layer } from "effect";
import { AppConfig, DATA_DIR } from "../config.ts";
import { compoundRules } from "./compounds.ts";
import { phraseIndex } from "./context.ts";
import { openDictionary, type DictionaryDb } from "@dict/core/DictionaryDb";
import { pairLanguage, type Language } from "@dict/core/language";
import { lookupWord } from "./lookup.ts";
import { warmCompounds } from "./queries.ts";
import type { LookupBody } from "../domain/schemas.ts";

/** The dictionary files of the language pairs this server lists. */
export class Dictionaries extends Context.Service<
  Dictionaries,
  {
    /** `context` is the sentence around `word`, when the client sent one. */
    readonly lookup: (
      pair: string,
      word: string,
      context?: string,
    ) => LookupBody;
  }
>()("server/dictionary/Dictionaries") {
  /**
   * Opens `<dir>/<pair>.sqlite` for each listed pair, with the source
   * language's record (`languages/<lang>/language.toml`, defaults when there
   * is none); a missing file or an invalid record is fatal.
   * With `context` on, the phrase index is built here, not on the first lookup.
   */
  static readonly layer = (dir = DATA_DIR) =>
    Layer.effect(
      Dictionaries,
      Effect.gen(function* () {
        const { languages, context } = yield* AppConfig;
        const files = new Map<
          string,
          { readonly db: DictionaryDb; readonly language: Language }
        >();
        for (const pair of languages) {
          const db = yield* openDictionary(`${dir}/${pair}.sqlite`);
          const language = yield* pairLanguage(pair);
          if (context) phraseIndex(db, language);
          const rules = compoundRules(language);
          if (rules !== undefined) warmCompounds(db, rules);
          files.set(pair, { db, language });
        }
        return Dictionaries.of({
          lookup: (pair, word, sentence) => {
            const file = files.get(pair);
            return file === undefined
              ? { entries: [] }
              : lookupWord(file.db, file.language, word, sentence);
          },
        });
      }),
    ).pipe(Layer.orDie);
}
