import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../api/Api.ts";
import { PlatformLive } from "../platform.ts";
import { DictHandlers } from "./DictHandlers.ts";
import { LegalPagesLive } from "./legalPages.ts";

/**
 * Answers an unknown route with a plain 404. The router's own error names the
 * full URL, and the request logger would write its query string to the log:
 * a client that still sends lookups as GET would leave words and sentences there.
 */
const QuietNotFound = HttpRouter.middleware(
  (httpEffect) =>
    Effect.catch(httpEffect, (error) =>
      HttpServerError.isHttpServerError(error) &&
      error.reason._tag === "RouteNotFound"
        ? Effect.succeed(HttpServerResponse.empty({ status: 404 }))
        : Effect.fail(error),
    ),
  { global: true },
);

export const makeHttpLive = (
  handlers: typeof DictHandlers = DictHandlers,
  legalPages: typeof LegalPagesLive = LegalPagesLive,
) =>
  Layer.merge(HttpApiBuilder.layer(Api), legalPages).pipe(
    Layer.provide(handlers),
    Layer.provide(PlatformLive),
    Layer.provide(QuietNotFound),
    Layer.provide(
      HttpRouter.cors({
        allowedHeaders: ["x-nonce", "content-type"],
        exposedHeaders: ["x-signature"],
      }),
    ),
    Layer.provide(HttpServer.layerServices),
  );

export const HttpLive = makeHttpLive();

export const makeWebHandler = (
  handlers: typeof DictHandlers = DictHandlers,
  legalPages: typeof LegalPagesLive = LegalPagesLive,
) => HttpRouter.toWebHandler(makeHttpLive(handlers, legalPages));
