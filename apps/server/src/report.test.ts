import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { reportUrl } from "./report.ts";

describe("reportUrl", () => {
  it.effect("keeps an https URL as written", () =>
    Effect.gen(function* () {
      const url =
        "https://github.com/d0-lang/dict-server-ts/issues/new?template=word.yml";
      assert.strictEqual(yield* reportUrl(url), url);
    }),
  );

  it.effect("is undefined when unset", () =>
    Effect.gen(function* () {
      assert.isUndefined(yield* reportUrl(undefined));
    }),
  );

  it.effect("fails on anything but an absolute https URL", () =>
    Effect.gen(function* () {
      for (const value of [
        "http://example.org/report",
        "ftp://example.org/report",
        "/issues/new",
        "example.org/report",
        "javascript:alert(1)",
      ]) {
        const exit = yield* Effect.exit(reportUrl(value));
        assert.isTrue(Exit.isFailure(exit), value);
      }
    }),
  );
});
