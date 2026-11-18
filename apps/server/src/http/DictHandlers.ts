import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";
import { Api, LookupBodyErrors } from "../api/Api.ts";
import { AppConfig } from "../config.ts";
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
import { reportUrl } from "../report.ts";
import { signedMetaResponse } from "./signMeta.ts";

const LookupBodyErrorsLive = HttpApiMiddleware.layerSchemaErrorTransform(
  LookupBodyErrors,
  () => Effect.fail(new LookupError({ error: "bad_request" })),
);

export const DictHandlersNoDeps = HttpApiBuilder.group(
  Api,
  "dict",
  Effect.fnUntraced(function* (handlers) {
    const identity = yield* Identity;
    const config = yield* AppConfig;
    const dictionaries = yield* Dictionaries;

    // A document that can't be read is fatal: its hash is what tells clients it changed.
    const legal = yield* legalSection(config).pipe(Effect.orDie);
    // So is a report link that isn't an absolute https URL (index.ts checks both first).
    const report_url = yield* reportUrl(config.reportUrl).pipe(Effect.orDie);

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
            ...(report_url !== undefined ? { report_url } : {}),
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
      lookup: ({ payload }) => {
        const { word, lang, context, at } = payload;
        // Checked before any lookup work: the length of `word` and `context`
        // is what makes a lookup expensive.
        if (
          typeof word !== "string" ||
          word === "" ||
          word.length > MAX_WORD ||
          typeof lang !== "string" ||
          lang === "" ||
          (context !== undefined && typeof context !== "string") ||
          (config.context &&
            ((context !== undefined && context.length > MAX_CONTEXT) ||
              (at !== undefined && !isClickedCopy(at))))
        ) {
          return Effect.fail(new LookupError({ error: "bad_request" }));
        }
        if (!config.languages.includes(lang)) {
          return Effect.fail(new LookupError({ error: "unsupported_lang" }));
        }
        return Effect.succeed(
          new LookupResponse(
            dictionaries.lookup(
              lang,
              word,
              config.context ? context : undefined,
              config.context && isClickedCopy(at) ? at : undefined,
            ),
          ),
        );
      },
    });
  }),
).pipe(Layer.provideMerge(LookupBodyErrorsLive));

/** The protocol's caps, in UTF-16 code units, which is what `length` counts. */
const MAX_WORD = 64;
const MAX_CONTEXT = 500;

/** `at` names a copy of `word` in `context`, so it is at most the sentence's length. */
const isClickedCopy = (at: unknown): at is number =>
  typeof at === "number" && Number.isInteger(at) && at > 0 && at <= MAX_CONTEXT;

export const DictHandlers = DictHandlersNoDeps.pipe(
  Layer.provide([
    Identity.layer,
    AppConfig.layer,
    Dictionaries.layer().pipe(Layer.provide(AppConfig.layer)),
  ]),
);
