import { Context, Effect, Layer } from "effect";
import { loadConfig } from "../config.ts";
import {
  exportPrivateKeyPkcs8Base64,
  exportPublicKeyBase64,
  generateKeyPair,
  importPrivateKey,
  signWithPrivateKey,
} from "./ed25519.ts";
import {
  readStoredIdentity,
  StoredIdentity,
  storedIdentityExists,
  writeStoredIdentity,
} from "./store.ts";

export class Identity extends Context.Service<
  Identity,
  {
    readonly publicKeyBase64: string;
    readonly sign: (body: Uint8Array) => Effect.Effect<string>;
  }
>()("server/identity/Identity") {
  static readonly layerMemory = Layer.effect(
    Identity,
    Effect.suspend(() => generateIdentity()),
  );

  static readonly layerFile = (path: string) =>
    Layer.effect(Identity, loadOrCreateIdentity(path));

  static readonly layer = Layer.unwrap(
    Effect.sync(() => Identity.layerFile(loadConfig().identityFile)),
  );
}

const generateIdentity = Effect.fnUntraced(function* () {
  const pair = yield* generateKeyPair();
  const publicKeyBase64 = yield* exportPublicKeyBase64(pair.publicKey);
  return Identity.of({
    publicKeyBase64,
    sign: (body) => signWithPrivateKey(pair.privateKey, body),
  });
});

const loadOrCreateIdentity = Effect.fnUntraced(function* (path: string) {
  if (yield* storedIdentityExists(path)) {
    const stored = yield* readStoredIdentity(path);
    const privateKey = yield* importPrivateKey(stored.privateKeyPkcs8Base64);
    return Identity.of({
      publicKeyBase64: stored.publicKeyBase64,
      sign: (body) => signWithPrivateKey(privateKey, body),
    });
  }

  const pair = yield* generateKeyPair();
  const publicKeyBase64 = yield* exportPublicKeyBase64(pair.publicKey);
  yield* writeStoredIdentity(
    path,
    new StoredIdentity({
      publicKeyBase64,
      privateKeyPkcs8Base64: yield* exportPrivateKeyPkcs8Base64(pair.privateKey),
    }),
  );
  return Identity.of({
    publicKeyBase64,
    sign: (body) => signWithPrivateKey(pair.privateKey, body),
  });
});
