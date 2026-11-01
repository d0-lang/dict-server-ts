import { Context, Effect, Layer } from "effect";
import { AppConfig } from "../config.ts";
import type { LookupEntry } from "../domain/schemas.ts";
import { findEntriesByForm } from "./queries.ts";
import { openDictionary } from "./DictionaryDb.ts";

/** The dictionary files of the language pairs this server lists. */
export class Dictionaries extends Context.Service<
  Dictionaries,
  {
    readonly lookup: (pair: string, word: string) => ReadonlyArray<LookupEntry>;
  }
>()("server/dictionary/Dictionaries") {
  /** Opens `<dir>/<pair>.sqlite` for each listed pair; a missing file is fatal. */
  static readonly layer = (dir = "data") =>
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
            return db === undefined ? [] : findEntriesByForm(db, word);
          },
        });
      }),
    ).pipe(Layer.orDie);
}
