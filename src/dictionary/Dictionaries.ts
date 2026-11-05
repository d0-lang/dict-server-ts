import { Context, Effect, Layer } from "effect";
import { AppConfig, DATA_DIR } from "../config.ts";
import { compoundRules } from "./compounds.ts";
import { phraseIndex } from "./context.ts";
import { openDictionary, type DictionaryDb } from "./DictionaryDb.ts";
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
   * Opens `<dir>/<pair>.sqlite` for each listed pair; a missing file is fatal.
   * With `context` on, the phrase index is built here, not on the first lookup.
   */
  static readonly layer = (dir = DATA_DIR) =>
    Layer.effect(
      Dictionaries,
      Effect.gen(function* () {
        const { languages, context } = yield* AppConfig;
        const files = new Map<string, DictionaryDb>();
        for (const pair of languages) {
          const db = yield* openDictionary(`${dir}/${pair}.sqlite`);
          if (context) phraseIndex(db, pair.split("_")[0]!);
          const rules = compoundRules(pair);
          if (rules !== undefined) warmCompounds(db, rules);
          files.set(pair, db);
        }
        return Dictionaries.of({
          lookup: (pair, word, sentence) => {
            const db = files.get(pair);
            return db === undefined
              ? { entries: [] }
              : lookupWord(db, pair, word, sentence);
          },
        });
      }),
    ).pipe(Layer.orDie);
}
