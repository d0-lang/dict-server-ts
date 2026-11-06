import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../api/Api.ts";
import { AppConfig, loadConfig } from "../config.ts";
import { Dictionaries } from "../dictionary/Dictionaries.ts";
import {
  Legal,
  LookupError,
  LookupResponse,
  Meta,
  PublicKey,
} from "../domain/schemas.ts";
import { Identity } from "../identity/Identity.ts";
import { lookupStub } from "./lookupStub.ts";
import { signedMetaResponse } from "./signMeta.ts";

const sha256Hex = Effect.fnUntraced(function* (text: string) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    catch: (cause) => new Error(`Failed to hash text: ${String(cause)}`),
  });
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
});

export const DictHandlersNoDeps = HttpApiBuilder.group(
  Api,
  "dict",
  Effect.fnUntraced(function* (handlers) {
    const identity = yield* Identity;
    const config = yield* AppConfig;
    const dictionaries = yield* Dictionaries;

    const privacy_hash = yield* sha256Hex(config.privacyShort);
    const tos_hash = yield* sha256Hex(config.tosShort);
    const legal = config.includeLegal
      ? new Legal({
          privacy_hash,
          tos_hash,
          privacy_short: config.privacyShort,
          tos_short: config.tosShort,
          privacy_link: config.privacyLink,
          tos_link: config.tosLink,
          ...(config.privacyChange !== undefined
            ? { privacy_change: config.privacyChange }
            : {}),
          ...(config.tosChange !== undefined
            ? { tos_change: config.tosChange }
            : {}),
        })
      : undefined;

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
            ...(config.context ? { features: ["context"] } : {}),
            ...(legal !== undefined ? { legal } : {}),
          }),
        ).pipe(Effect.orDie),
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
                  ),
                ),
              ),
    });
  }),
);

/** In-memory handlers for tests: a stub dictionary and `de_en`, whatever is in `data/`. */
export const DictHandlersMemory = DictHandlersNoDeps.pipe(
  Layer.provide([
    Identity.layerMemory,
    Layer.sync(AppConfig, () =>
      AppConfig.of({ ...loadConfig(), languages: ["de_en"] }),
    ),
    Layer.succeed(Dictionaries, {
      lookup: (_pair, word) => lookupStub(word),
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
