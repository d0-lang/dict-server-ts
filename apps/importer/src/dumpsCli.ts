import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { languageCodes } from "@dict/core/language";
import { Console, Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { isSnapshot, readPins, reportComparisons, writePins } from "./dumps.ts";
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

const readStats = (file: string): ImportStats | undefined =>
  existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as ImportStats)
    : undefined;

const report = Command.make(
  "report",
  { dir: Argument.String("dir") },
  Effect.fn(function* ({ dir }) {
    const comparisons = languageCodes().map((lang) => ({
      lang,
      old: readStats(join(dir, `${lang}.old.json`)),
      new: readStats(join(dir, `${lang}.new.json`)),
    }));
    yield* Console.log(reportComparisons(comparisons));
  }),
).pipe(
  Command.withDescription(
    "Compare <dir>/<lang>.old.json with <lang>.new.json (import summaries) as a Markdown table",
  ),
);

Command.make("dumps").pipe(
  Command.withDescription("The dump snapshots pinned in dumps.toml"),
  Command.withSubcommands([pinned, pin, report]),
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
