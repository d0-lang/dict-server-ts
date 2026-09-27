import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api/Api.ts"
import { DictHandlers } from "./DictHandlers.ts"

export const HttpLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(DictHandlers),
  Layer.provide(HttpRouter.cors({
    allowedHeaders: ["x-nonce", "content-type"],
    exposedHeaders: ["x-signature"]
  })),
  Layer.provide(HttpServer.layerServices)
)

export const makeWebHandler = () => HttpRouter.toWebHandler(HttpLive)
