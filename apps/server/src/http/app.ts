import { Effect, Layer, Option } from "effect";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
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

/**
 * In place of the request logger with `LOG_REQUESTS=false`: its line only for
 * a request the server failed (a 5xx), with the cause. Nothing for one that
 * worked, a client's mistake (4xx) or a client that gave up.
 */
const logFailures = HttpMiddleware.make((httpApp) =>
  Effect.onExit(httpApp, (exit) => {
    if (exit._tag === "Success") return Effect.void;
    const [response, cause] = HttpServerError.causeResponseStripped(exit.cause);
    if (
      response.status < 500 ||
      Option.isNone(cause) ||
      cause.value.reasons.every(
        (reason) =>
          reason._tag === "Interrupt" &&
          reason.annotations.has(HttpServerError.ClientAbort.key),
      )
    ) {
      return Effect.void;
    }
    return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Effect.logError(cause.value).pipe(
        Effect.annotateLogs({
          "http.method": request.method,
          "http.url": request.url.replace(/[?#].*$/s, ""),
          "http.status": response.status,
        }),
      ),
    );
  }),
);

export const makeWebHandler = (
  handlers: typeof DictHandlers = DictHandlers,
  legalPages: typeof LegalPagesLive = LegalPagesLive,
  { logRequests = true }: { readonly logRequests?: boolean } = {},
) =>
  HttpRouter.toWebHandler(
    makeHttpLive(handlers, legalPages),
    logRequests ? {} : { disableLogger: true, middleware: logFailures },
  );
