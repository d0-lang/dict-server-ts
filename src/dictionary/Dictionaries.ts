import { Context, Effect, Layer } from "effect";
import { AppConfig, DATA_DIR } from "../config.ts";
import type { LookupEntry } from "../domain/schemas.ts";
import { compoundLinkers } from "./compounds.ts";
import { findEntriesByForm, findEntriesWithCompounds } from "./queries.ts";
import { openDictionary } from "./DictionaryDb.ts";

/** The dictionary files of the language pairs this server lists. */
export class Dictionaries extends Context.Service<
  Dictionaries,
  {
    readonly lookup: (pair: string, word: string) => ReadonlyArray<LookupEntry>;
  }
>()("server/dictionary/Dictionaries") {
  /** Opens `<dir>/<pair>.sqlite` for each listed pair; a missing file is fatal. */
  static readonly layer = (dir = DATA_DIR) =>
    Layer.effect(
      Dictionaries,
      Effect.gen(function* () {
        const { languages } = yield* AppConfig;
        const files = new Map<
          string,
          Parameters<typeof findEntriesByForm>[0]
        >();
        for (const pair of languages) {
          files.set(pair, yield* openDictionary(`${dir}/${pair}.sqlite`));
        }
        return Dictionaries.of({
          lookup: (pair, word) => {
            const db = files.get(pair);
            return db === undefined
              ? []
              : findEntriesWithCompounds(db, word, compoundLinkers(pair));
          },
        });
      }),
    ).pipe(Layer.orDie);
}
