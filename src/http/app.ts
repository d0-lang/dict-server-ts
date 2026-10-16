import { Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../api/Api.ts";
import { PlatformLive } from "../platform.ts";
import { DictHandlers } from "./DictHandlers.ts";

export const makeHttpLive = (handlers: typeof DictHandlers = DictHandlers) =>
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide(handlers),
    Layer.provide(PlatformLive),
    Layer.provide(
      HttpRouter.cors({
        allowedHeaders: ["x-nonce", "content-type"],
        exposedHeaders: ["x-signature"],
      }),
    ),
    Layer.provide(HttpServer.layerServices),
  );

export const HttpLive = makeHttpLive();

export const makeWebHandler = (handlers: typeof DictHandlers = DictHandlers) =>
  HttpRouter.toWebHandler(makeHttpLive(handlers));
