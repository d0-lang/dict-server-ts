import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { languageCodes } from "@dict/core/language";
import { Command, Flag } from "effect/cli";
import { filterDump } from "./filterDump.ts";

const command = Command.make(
  "filter",
  {
    lang: Flag.String("lang").pipe(
      Flag.withDescription(
        "wiktextract lang_codes to keep, comma-separated, or `all` for every language in languages/",
      ),
      Flag.withDefault("all"),
    ),
    input: Flag.String("input").pipe(
      Flag.withAlias("i"),
      Flag.withDescription(
        "raw wiktextract dump: local path or URL, plain or .gz",
      ),
    ),
    outDir: Flag.String("out-dir").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("directory for one <lang>.jsonl per language"),
      Flag.withDefault("data/raw"),
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("overwrite files that already exist"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* ({ lang, input, outDir, force }) {
    const langs =
      lang.trim() === "all"
        ? languageCodes()
        : lang
            .split(",")
            .map((code) => code.trim())
            .filter((code) => code !== "");
    const stats = yield* filterDump({ langs, input, outDir, force });
    yield* Console.log(JSON.stringify(stats, null, 2));
  }),
).pipe(
  Command.withDescription(
    "Copy languages' lines out of the raw wiktextract dump, in one pass",
  ),
);

command.pipe(
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
