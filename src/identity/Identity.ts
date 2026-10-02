import { Context, Effect, Encoding, Layer, Schema } from "effect";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "../config.ts";

const subtle = globalThis.crypto.subtle;

class StoredIdentity extends Schema.Class<StoredIdentity>(
  "server/identity/StoredIdentity",
)({
  publicKeyBase64: Schema.String,
  privateKeyPkcs8Base64: Schema.String,
}) {}

const copyForSubtle = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes);

const generateKeyPair = Effect.fnUntraced(function* () {
  const generated = yield* Effect.tryPromise({
    try: () => subtle.generateKey("Ed25519", true, ["sign", "verify"]),
    catch: (cause) =>
      new Error(`Failed to generate Ed25519 key: ${String(cause)}`),
  }).pipe(Effect.orDie);

  if (!("privateKey" in generated) || !("publicKey" in generated)) {
    return yield* Effect.die(new Error("Expected an Ed25519 CryptoKeyPair"));
  }
  return generated;
});

const exportPublicKeyBase64 = Effect.fnUntraced(function* (
  publicKey: CryptoKey,
) {
  const raw = yield* Effect.tryPromise({
    try: () => subtle.exportKey("raw", publicKey),
    catch: (cause) =>
      new Error(`Failed to export Ed25519 public key: ${String(cause)}`),
  }).pipe(Effect.orDie);
  return Encoding.encodeBase64(new Uint8Array(raw));
});

const exportPrivateKeyPkcs8Base64 = Effect.fnUntraced(function* (
  privateKey: CryptoKey,
) {
  const pkcs8 = yield* Effect.tryPromise({
    try: () => subtle.exportKey("pkcs8", privateKey),
    catch: (cause) =>
      new Error(`Failed to export Ed25519 private key: ${String(cause)}`),
  }).pipe(Effect.orDie);
  return Encoding.encodeBase64(new Uint8Array(pkcs8));
});

const importPrivateKey = Effect.fnUntraced(function* (pkcs8Base64: string) {
  const bytes = Encoding.decodeBase64(pkcs8Base64);
  if (bytes._tag === "Failure") {
    return yield* Effect.die(new Error("Invalid private key base64"));
  }
  return yield* Effect.tryPromise({
    try: () =>
      subtle.importKey("pkcs8", copyForSubtle(bytes.success), "Ed25519", true, [
        "sign",
      ]),
    catch: (cause) =>
      new Error(`Failed to import Ed25519 private key: ${String(cause)}`),
  }).pipe(Effect.orDie);
});

const makeIdentity = (keys: {
  readonly privateKey: CryptoKey;
  readonly publicKeyBase64: string;
}) =>
  Identity.of({
    publicKeyBase64: keys.publicKeyBase64,
    sign: Effect.fnUntraced(function* (body: Uint8Array) {
      const signature = yield* Effect.tryPromise({
        try: () => subtle.sign("Ed25519", keys.privateKey, copyForSubtle(body)),
        catch: (cause) => new Error(`Failed to sign body: ${String(cause)}`),
      }).pipe(Effect.orDie);
      return Encoding.encodeBase64(new Uint8Array(signature));
    }),
  });

const generateIdentity = Effect.fnUntraced(function* () {
  const pair = yield* generateKeyPair();
  const publicKeyBase64 = yield* exportPublicKeyBase64(pair.publicKey);
  return makeIdentity({
    privateKey: pair.privateKey,
    publicKeyBase64,
  });
});

const readStoredIdentity = Effect.fnUntraced(function* (path: string) {
  const json = yield* Effect.tryPromise({
    try: () => Bun.file(path).json(),
    catch: (cause) =>
      new Error(`Failed to read identity file ${path}: ${String(cause)}`),
  }).pipe(Effect.orDie);
  return yield* Schema.decodeUnknownEffect(StoredIdentity)(json).pipe(
    Effect.orDie,
  );
});

const writeStoredIdentity = Effect.fnUntraced(function* (
  path: string,
  stored: StoredIdentity,
) {
  yield* Effect.tryPromise({
    try: () => mkdir(dirname(path), { recursive: true }),
    catch: (cause) =>
      new Error(`Failed to create identity directory: ${String(cause)}`),
  }).pipe(Effect.orDie);
  yield* Effect.tryPromise({
    try: () => Bun.write(path, `${JSON.stringify(stored, null, 2)}\n`),
    catch: (cause) =>
      new Error(`Failed to write identity file ${path}: ${String(cause)}`),
  }).pipe(Effect.orDie);
});

const loadOrCreateIdentity = Effect.fnUntraced(function* (path: string) {
  const exists = yield* Effect.tryPromise({
    try: () => Bun.file(path).exists(),
    catch: (cause) =>
      new Error(`Failed to stat identity file ${path}: ${String(cause)}`),
  }).pipe(Effect.orDie);

  if (exists) {
    const stored = yield* readStoredIdentity(path);
    const privateKey = yield* importPrivateKey(stored.privateKeyPkcs8Base64);
    return makeIdentity({
      privateKey,
      publicKeyBase64: stored.publicKeyBase64,
    });
  }

  const pair = yield* generateKeyPair();
  const publicKeyBase64 = yield* exportPublicKeyBase64(pair.publicKey);
  const identity = makeIdentity({
    privateKey: pair.privateKey,
    publicKeyBase64,
  });
  yield* writeStoredIdentity(
    path,
    new StoredIdentity({
      publicKeyBase64,
      privateKeyPkcs8Base64: yield* exportPrivateKeyPkcs8Base64(pair.privateKey),
    }),
  );
  return identity;
});

export class Identity extends Context.Service<
  Identity,
  {
    readonly publicKeyBase64: string;
    readonly sign: (body: Uint8Array) => Effect.Effect<string>;
  }
>()("server/identity/Identity") {
  static readonly layerMemory = Layer.effect(Identity, generateIdentity());

  static readonly layerFile = (path: string) =>
    Layer.effect(Identity, loadOrCreateIdentity(path));

  static readonly layer = Layer.unwrap(
    Effect.sync(() => Identity.layerFile(loadConfig().identityFile)),
  );
}
