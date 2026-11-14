import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../api/Api.ts";
import { AppConfig, loadConfig } from "../config.ts";
import { Dictionaries } from "../lookup/Dictionaries.ts";
import {
  LabelsResponse,
  LookupError,
  LookupResponse,
  Meta,
  PublicKey,
} from "../domain/schemas.ts";
import { Identity } from "../identity/Identity.ts";
import { SOURCES } from "../lookup/common/sources.ts";
import { legalSection } from "../legal.ts";
import { lookupStub } from "./lookupStub.ts";
import { signedMetaResponse } from "./signMeta.ts";

export const DictHandlersNoDeps = HttpApiBuilder.group(
  Api,
  "dict",
  Effect.fnUntraced(function* (handlers) {
    const identity = yield* Identity;
    const config = yield* AppConfig;
    const dictionaries = yield* Dictionaries;

    // A document that can't be read is fatal: its hash is what tells clients it changed.
    const legal = yield* legalSection(config).pipe(Effect.orDie);

    return handlers.handleAll({
      getKey: () =>
        Effect.succeed(new PublicKey({ key: identity.publicKeyBase64 })),
      getMeta: ({ headers }) =>
        signedMetaResponse(
          identity.sign,
          new Meta({
            name: config.name,
            nonce: headers["x-nonce"],
            languages: [...config.languages],
            verification_urls: [...config.verificationUrls],
            sources: SOURCES.map((source) => ({ ...source })),
            features: [
              ...(config.context ? ["context", "context-match"] : []),
              "labels",
            ],
            ...(legal !== undefined ? { legal } : {}),
          }),
        ).pipe(Effect.orDie),
      getLabels: ({ query }) => {
        const pairs = [
          ...new Set(
            (query.lang ?? "")
              .split(",")
              .map((pair) => pair.trim())
              .filter((pair) => pair !== ""),
          ),
        ];
        if (pairs.length === 0) {
          return Effect.fail(new LookupError({ error: "bad_request" }));
        }
        // A pair the server doesn't serve is left out.
        return Effect.succeed(
          new LabelsResponse({
            labels: Object.fromEntries(
              pairs.flatMap((pair) => {
                const labels = config.languages.includes(pair)
                  ? dictionaries.labels(pair)
                  : undefined;
                return labels === undefined ? [] : [[pair, { ...labels }]];
              }),
            ),
          }),
        );
      },
      lookup: ({ query }) =>
        !query.word || !query.lang
          ? Effect.fail(new LookupError({ error: "bad_request" }))
          : !config.languages.includes(query.lang)
            ? Effect.fail(new LookupError({ error: "unsupported_lang" }))
            : Effect.succeed(
                new LookupResponse(
                  dictionaries.lookup(
                    query.lang,
                    query.word,
                    config.context ? query.context : undefined,
                    config.context ? clickedCopy(query.at) : undefined,
                  ),
                ),
              ),
    });
  }),
);

/** `at` as a number; anything but a positive integer is ignored, as if it weren't sent. */
const clickedCopy = (at: string | undefined): number | undefined => {
  const n = at === undefined ? NaN : Number(at);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** In-memory handlers for tests: a stub dictionary and `de_en`, whatever is in `data/`. */
export const DictHandlersMemory = DictHandlersNoDeps.pipe(
  Layer.provide([
    Identity.layerMemory,
    Layer.sync(AppConfig, () =>
      AppConfig.of({
        ...loadConfig(),
        languages: ["de_en"],
        privacyFile: "legal/privacy.example.md",
        tosFile: "legal/terms.example.md",
      }),
    ),
    Layer.succeed(Dictionaries, {
      lookup: (_pair, word) => lookupStub(word),
      // German shows gender as the article; `c` is the rare common gender.
      labels: () => ({ c: { name: "common gender" } }),
    }),
  ]),
);

export const DictHandlers = DictHandlersNoDeps.pipe(
  Layer.provide([
    Identity.layer,
    AppConfig.layer,
    Dictionaries.layer().pipe(Layer.provide(AppConfig.layer)),
  ]),
);
