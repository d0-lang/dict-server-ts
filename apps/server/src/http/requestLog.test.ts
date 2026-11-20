import { afterEach, assert, describe, it, vi } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { makeWebHandler } from "./app.ts";
import { dictHandlersMemory, legalPagesMemory } from "./testing.ts";

/** The test routes, plus one that dies. */
const routes = Layer.merge(
  legalPagesMemory({ includeLegal: false }),
  HttpRouter.add("GET", "/boom", Effect.die(new Error("boom"))),
);

/** What the server logs while it answers `paths`, one string per console call. */
const logsOf = async (logRequests: boolean, paths: ReadonlyArray<string>) => {
  const { handler, dispose } = makeWebHandler(
    dictHandlersMemory({ includeLegal: false }),
    routes,
    { logRequests },
  );
  const lines: Array<string> = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  for (const method of methods) {
    vi.spyOn(console, method).mockImplementation((...args: Array<unknown>) => {
      lines.push(args.map((arg) => Bun.inspect(arg)).join(" "));
    });
  }
  for (const path of paths)
    await handler(new Request(`http://localhost${path}`));
  await dispose();
  return lines;
};

describe("LOG_REQUESTS", () => {
  afterEach(() => vi.restoreAllMocks());

  it("on, logs a line per request, without the query string", async () => {
    const lines = await logsOf(true, ["/v1/get-key?word=Hund", "/nope"]);
    assert.strictEqual(lines.length, 2);
    assert.include(lines[0], "/v1/get-key");
    assert.notInclude(lines.join("\n"), "Hund");
  });

  it("off, logs nothing for answers and client errors", async () => {
    assert.deepStrictEqual(
      await logsOf(false, ["/v1/get-key", "/v1/get-meta", "/nope?word=Hund"]),
      [],
    );
  });

  it("off, still logs a request that fails, with its cause", async () => {
    const lines = await logsOf(false, ["/v1/get-key", "/boom?word=Hund"]);
    assert.strictEqual(lines.length, 1);
    assert.include(lines[0], "boom");
    assert.include(lines[0], "500");
    assert.notInclude(lines[0], "Hund");
  });
});
