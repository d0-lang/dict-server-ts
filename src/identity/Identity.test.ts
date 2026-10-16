import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Base64 } from "effect/encoding";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlatformLive } from "../platform.ts";
import { Identity } from "./Identity.ts";

const utf8 = new TextEncoder();
const subtle = globalThis.crypto.subtle;

const copyForSubtle = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes);

const verifyWithPublicKey = async (
  publicKeyBase64: string,
  body: Uint8Array,
  signatureBase64: string,
) => {
  const publicKeyBytes = Base64.decode(publicKeyBase64);
  const signatureBytes = Base64.decode(signatureBase64);
  if (publicKeyBytes._tag === "Failure" || signatureBytes._tag === "Failure") {
    return false;
  }
  const publicKey = await subtle.importKey(
    "raw",
    copyForSubtle(publicKeyBytes.success),
    "Ed25519",
    false,
    ["verify"],
  );
  return subtle.verify(
    "Ed25519",
    publicKey,
    copyForSubtle(signatureBytes.success),
    copyForSubtle(body),
  );
};

describe("Identity", () => {
  it.effect("signs body bytes and verifies them", () =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      const body = utf8.encode(`{"nonce":"abc"}`);
      const signature = yield* identity.sign(body);

      assert.isTrue(
        yield* Effect.promise(() =>
          verifyWithPublicKey(identity.publicKeyBase64, body, signature),
        ),
      );
      assert.isFalse(
        yield* Effect.promise(() =>
          verifyWithPublicKey(
            identity.publicKeyBase64,
            utf8.encode(`{"nonce":"abd"}`),
            signature,
          ),
        ),
      );
      assert.isString(identity.publicKeyBase64);
      assert.isAbove(identity.publicKeyBase64.length, 0);
    }).pipe(Effect.provide(Identity.layerMemory)),
  );

  it.effect("reloads the same public key from disk", () =>
    Effect.gen(function* () {
      const path = join(tmpdir(), `dict-identity-${crypto.randomUUID()}.json`);
      const fileLayer = Identity.layerFile(path).pipe(
        Layer.provide(PlatformLive),
      );
      const first = yield* Identity.pipe(Effect.provide(fileLayer));
      const second = yield* Identity.pipe(Effect.provide(fileLayer));
      assert.strictEqual(second.publicKeyBase64, first.publicKeyBase64);
      const signature = yield* first.sign(utf8.encode(`{"nonce":"reload"}`));
      assert.isTrue(
        yield* Effect.promise(() =>
          verifyWithPublicKey(
            second.publicKeyBase64,
            utf8.encode(`{"nonce":"reload"}`),
            signature,
          ),
        ),
      );
    }),
  );
});
