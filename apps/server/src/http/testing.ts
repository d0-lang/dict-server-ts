import { Layer } from "effect";
import { AppConfig, loadConfig, type AppConfigValues } from "../config.ts";
import { Identity } from "../identity/Identity.ts";
import { Dictionaries } from "../lookup/Dictionaries.ts";
import { lookupWord } from "../lookup/lookup.ts";
import { languageOf } from "../lookup/testing/dictionary.ts";
import { german } from "../lookup/testing/german.ts";
import { DictHandlersNoDeps } from "./DictHandlers.ts";
import { LegalPages } from "./legalPages.ts";

/**
 * In-memory handlers for tests: `de_en` on the German test dictionary
 * (`lookup/testing/german.ts`) through the real lookup, the legal section on,
 * no report link, and `config` over the rest.
 */
export const dictHandlersMemory = (config: Partial<AppConfigValues> = {}) =>
  DictHandlersNoDeps.pipe(
    Layer.provide([
      Identity.layerMemory,
      Layer.sync(AppConfig, () =>
        AppConfig.of({
          ...loadConfig(),
          languages: ["de_en"],
          // The defaults: the templates and example.invalid links.
          includeLegal: true,
          reportUrl: undefined,
          ...config,
        }),
      ),
      Layer.succeed(Dictionaries, {
        lookup: (pair, word, context, at) =>
          pair === "de_en"
            ? lookupWord(german, languageOf(pair), word, context, at)
            : { entries: [] },
        // German shows gender as the article; `c` is the rare common gender.
        labels: () => ({ c: { name: "common gender" } }),
      }),
    ]),
  );

export const DictHandlersMemory = dictHandlersMemory();

/** The legal pages on the test configuration: the templates, legal on, `config` over the rest. */
export const legalPagesMemory = (config: Partial<AppConfigValues> = {}) =>
  LegalPages.pipe(
    Layer.provide(
      Layer.sync(AppConfig, () =>
        AppConfig.of({ ...loadConfig(), includeLegal: true, ...config }),
      ),
    ),
  );
