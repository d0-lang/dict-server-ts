import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { filterDump } from "./filterDump.ts";

const command = Command.make(
  "filter",
  {
    lang: Flag.String("lang").pipe(
      Flag.withDescription("wiktextract lang_code to keep"),
      Flag.withDefault("pl"),
    ),
    input: Flag.String("input").pipe(
      Flag.withAlias("i"),
      Flag.withDescription(
        "raw wiktextract dump: local path or URL, plain or .gz",
      ),
    ),
    out: Flag.String("out").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("output JSONL file"),
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("overwrite the output file if it already exists"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (options) {
    const stats = yield* filterDump(options);
    yield* Console.log(JSON.stringify(stats, null, 2));
  }),
).pipe(
  Command.withDescription(
    "Copy one language's lines out of the raw wiktextract dump",
  ),
);

command.pipe(
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
