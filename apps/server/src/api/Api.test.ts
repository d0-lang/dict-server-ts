import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpApiTest } from "effect/http-api";
import { HttpServer } from "effect/http";
import { Api } from "./Api.ts";
import { DictHandlersMemory } from "../http/DictHandlers.ts";

const HandlersLayer = Layer.mergeAll(
  DictHandlersMemory,
  HttpServer.layerServices,
);
const makeClient = HttpApiTest.groups(Api, ["dict"]);

layer(HandlersLayer)("DictApi", (it) => {
  it.effect("returns the Ed25519 public key", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const key = yield* client.dict.getKey();
      assert.isString(key.key);
      assert.isAbove(key.key.length, 0);
    }),
  );

  it.effect("echoes X-Nonce in metadata", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const meta = yield* client.dict.getMeta({
        headers: { "x-nonce": "startup-1" },
      });
      const body = "body" in meta ? meta.body : meta;
      assert.strictEqual(body.nonce, "startup-1");
      assert.strictEqual(body.name, "dict poc");
      assert.deepStrictEqual(body.languages, ["de_en"]);
    }),
  );

  it.effect("looks up a word in the protocol's shape", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const result = yield* client.dict.lookup({
        query: { word: "Mutter", lang: "de_en" },
      });
      assert.deepStrictEqual(
        result.entries.map((e) => e.senses[0]?.glosses),
        [["mother"], ["nut (for a bolt)"]],
      );
    }),
  );
});
