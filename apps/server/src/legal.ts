import { readFileSync } from "node:fs";
import { Effect } from "effect";
import type { AppConfigValues } from "./config.ts";
import { Legal } from "./domain/schemas.ts";

/**
 * The metadata's `legal` section (Protocol.md, Legal): links to the privacy
 * policy and terms the operator publishes, and the sha256 of each one's
 * source text, read from the files `PRIVACY_FILE` and `TOS_FILE` name. A
 * changed file changes the hash, and clients then pause lookups until their
 * user has seen the notice. The client never fetches a document to check it,
 * so the files must be the text published at the links.
 */

/** The longest `privacy_change` / `tos_change` a client shows; it drops longer ones. */
export const MAX_CHANGE_LENGTH = 500;

/** Lowercase hex sha256 of the exact bytes. */
export const sha256Hex = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** The `[[...]]` placeholders (`[[CONTACT EMAIL]]`) a document still has, each once. */
export const placeholders = (text: string): ReadonlyArray<string> => [
  ...new Set(text.match(/\[\[[^\]]*\]\]/g) ?? []),
];

const readDocument = (file: string, setting: string) =>
  Effect.try({
    try: () => new Uint8Array(readFileSync(file)),
    catch: (cause) =>
      new Error(
        `${setting}=${file}: cannot read the document to hash (${cause instanceof Error ? cause.message : String(cause)}). Start from the templates in legal/ (legal/README.md), or set INCLUDE_LEGAL=false.`,
      ),
  });

const checkChange = (text: string | undefined, setting: string) =>
  text !== undefined && text.length > MAX_CHANGE_LENGTH
    ? Effect.fail(
        new Error(
          `${setting} is ${text.length} characters; clients drop change texts over ${MAX_CHANGE_LENGTH}`,
        ),
      )
    : Effect.void;

/**
 * The `legal` section, or undefined with `INCLUDE_LEGAL=false`. Fails when a
 * document can't be read or a change text is too long; warns when a document
 * still has placeholders to fill in.
 */
export const legalSection = Effect.fnUntraced(function* (
  config: AppConfigValues,
) {
  if (!config.includeLegal) return undefined;
  yield* checkChange(config.privacyChange, "PRIVACY_CHANGE");
  yield* checkChange(config.tosChange, "TOS_CHANGE");
  const documents = [
    { setting: "PRIVACY_FILE", file: config.privacyFile },
    { setting: "TOS_FILE", file: config.tosFile },
  ];
  const hashes: Array<string> = [];
  for (const { setting, file } of documents) {
    const bytes = yield* readDocument(file, setting);
    const left = placeholders(new TextDecoder().decode(bytes));
    if (left.length > 0) {
      yield* Effect.logWarning(
        `${setting}=${file} still has placeholders to fill in before the server goes public: ${left.join(", ")} (see legal/README.md)`,
      );
    }
    hashes.push(sha256Hex(bytes));
  }
  const [privacy_hash, tos_hash] = hashes as [string, string];
  return new Legal({
    privacy_link: config.privacyLink,
    privacy_hash,
    ...(config.privacyChange !== undefined
      ? { privacy_change: config.privacyChange }
      : {}),
    tos_link: config.tosLink,
    tos_hash,
    ...(config.tosChange !== undefined ? { tos_change: config.tosChange } : {}),
  });
});
