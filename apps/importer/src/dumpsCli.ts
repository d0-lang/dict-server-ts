import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { languageCodes } from "@dict/core/language";
import { Console, Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { isSnapshot, readPins, reportComparisons, writePins } from "./dumps.ts";
import { diffDictionaries, type DictDiff } from "./dictDiff.ts";
import type { ImportStats } from "./stats.ts";

const pinned = Command.make(
  "pinned",
  { lang: Argument.String("lang") },
  Effect.fn(function* ({ lang }) {
    yield* Console.log(readPins()[lang] ?? "");
  }),
).pipe(
  Command.withDescription(
    "Print the snapshot a language is pinned to, or nothing",
  ),
);

const pin = Command.make(
  "pin",
  { snapshot: Argument.String("snapshot") },
  Effect.fn(function* ({ snapshot }) {
    if (!isSnapshot(snapshot)) {
      return yield* Effect.fail(
        new Error(`${snapshot} is not a snapshot name like dump-2026-10-30`),
      );
    }
    const pins = Object.fromEntries(
      languageCodes().map((lang) => [lang, snapshot]),
    );
    yield* Effect.sync(() => writePins(pins));
  }),
).pipe(
  Command.withDescription(
    "Pin every language in languages/ to a snapshot (rewrites dumps.toml)",
  ),
);

const readJson = <A>(file: string): A | undefined =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as A) : undefined;

const diff = Command.make(
  "diff",
  { before: Argument.String("before"), after: Argument.String("after") },
  Effect.fn(function* ({ before, after }) {
    const result = yield* Effect.sync(() => diffDictionaries(before, after));
    yield* Console.log(JSON.stringify(result, null, 2));
  }),
).pipe(
  Command.withDescription(
    "What changed between two builds of a dictionary file, as JSON",
  ),
);

const report = Command.make(
  "report",
  { dir: Argument.String("dir") },
  Effect.fn(function* ({ dir }) {
    const comparisons = languageCodes().map((lang) => ({
      lang,
      old: readJson<ImportStats>(join(dir, `${lang}.old.json`)),
      new: readJson<ImportStats>(join(dir, `${lang}.new.json`)),
      diff: readJson<DictDiff>(join(dir, `${lang}.diff.json`)),
    }));
    yield* Console.log(reportComparisons(comparisons));
  }),
).pipe(
  Command.withDescription(
    "Report <dir>/<lang>.old.json against <lang>.new.json (import summaries) and <lang>.diff.json in Markdown",
  ),
);

Command.make("dumps").pipe(
  Command.withDescription("The dump snapshots pinned in dumps.toml"),
  Command.withSubcommands([pinned, pin, diff, report]),
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
