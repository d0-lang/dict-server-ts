import { assert, describe, it } from "@effect/vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { loadConfig } from "./config.ts";
import { legalSection, placeholders } from "./legal.ts";

const withDocuments = <A, E>(
  privacy: string,
  terms: string,
  use: (files: { privacyFile: string; tosFile: string }) => Effect.Effect<A, E>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "dict-legal-"))),
    (dir) => {
      const privacyFile = join(dir, "privacy.md");
      const tosFile = join(dir, "terms.md");
      writeFileSync(privacyFile, privacy);
      writeFileSync(tosFile, terms);
      return use({ privacyFile, tosFile });
    },
    (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
  );

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

describe("legalSection", () => {
  it.effect("hashes the source text of each document", () =>
    withDocuments("# Privacy\n\nNo cookies.\n", "# Terms\n", (files) =>
      Effect.gen(function* () {
        const legal = yield* legalSection({
          ...loadConfig(),
          ...files,
          includeLegal: true,
          privacyChange: "Logs are now kept for 7 days.",
          tosChange: undefined,
        });
        assert.deepStrictEqual(
          { ...legal },
          {
            privacy_link: "https://example.invalid/privacy",
            privacy_hash: sha256("# Privacy\n\nNo cookies.\n"),
            privacy_change: "Logs are now kept for 7 days.",
            tos_link: "https://example.invalid/tos",
            tos_hash: sha256("# Terms\n"),
          },
        );
      }),
    ),
  );

  it.effect("sends no section without INCLUDE_LEGAL", () =>
    Effect.gen(function* () {
      const legal = yield* legalSection({
        ...loadConfig(),
        includeLegal: false,
        privacyFile: "/nonexistent/privacy.md",
      });
      assert.isUndefined(legal);
    }),
  );

  it.effect(
    "fails on a missing document or a change text over 500 characters",
    () =>
      withDocuments("p", "t", (files) =>
        Effect.gen(function* () {
          const base = { ...loadConfig(), ...files, includeLegal: true };
          const missing = yield* Effect.exit(
            legalSection({ ...base, tosFile: `${files.tosFile}.missing` }),
          );
          assert.isTrue(Exit.isFailure(missing));
          const long = yield* Effect.exit(
            legalSection({ ...base, tosChange: "x".repeat(501) }),
          );
          assert.isTrue(Exit.isFailure(long));
          const fits = yield* legalSection({
            ...base,
            tosChange: "x".repeat(500),
          });
          assert.strictEqual(fits?.tos_change?.length, 500);
        }),
      ),
  );
});

describe("placeholders", () => {
  it("finds what the operator still has to fill in", () => {
    assert.deepStrictEqual(
      placeholders(
        "Run by [[OPERATOR]], [[COUNTRY]]. Law of [[COUNTRY]]. Logs: [[LOG DAYS]] days. [link](x)",
      ),
      ["[[OPERATOR]]", "[[COUNTRY]]", "[[LOG DAYS]]"],
    );
    assert.deepStrictEqual(placeholders("All filled in [1]."), []);
  });
});
