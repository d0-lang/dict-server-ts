import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command, Flag } from "effect/cli";
import { Console, Effect, Option } from "effect";
import { filterLanguageFile, importLanguage } from "./pipeline.ts";
import { pairFor } from "./languages.ts";

const lang = Flag.String("lang").pipe(
  Flag.withDescription("Wiktionary language code to keep, for example pl"),
);
const input = Flag.String("input").pipe(
  Flag.withDescription("JSONL file, or a .jsonl.gz raw wiktextract dump"),
);

const importCommand = Command.make(
  "import",
  {
    lang,
    input,
    output: Flag.String("output").pipe(
      Flag.withDescription(
        "SQLite file to write. Defaults to data/<pair>.sqlite",
      ),
      Flag.optional,
    ),
    batchSize: Flag.Int("batch-size").pipe(
      Flag.withDescription("JSONL lines per write transaction"),
      Flag.withDefault(500),
    ),
    concurrency: Flag.Int("concurrency").pipe(
      Flag.withDescription(
        "Concurrent write batches. SQLite writes are synchronous, so 1 is the useful setting",
      ),
      Flag.withDefault(1),
    ),
    vacuum: Flag.Boolean("vacuum").pipe(
      Flag.withDescription("VACUUM the database after import"),
      Flag.withDefault(true),
    ),
  },
  Effect.fn("importCommand")(function* (flags) {
    const output = Option.isSome(flags.output)
      ? flags.output.value
      : `data/${pairFor(flags.lang)}.sqlite`;
    const report = yield* importLanguage({
      lang: flags.lang,
      input: flags.input,
      output,
      batchSize: flags.batchSize,
      concurrency: flags.concurrency,
      vacuum: flags.vacuum,
    });
    yield* Console.log(JSON.stringify({ output, ...report }, null, 2));
  }),
).pipe(
  Command.withDescription(
    "Import one language from a wiktextract JSONL dump into SQLite",
  ),
);

const filterCommand = Command.make(
  "filter",
  {
    lang,
    input,
    output: Flag.String("output").pipe(
      Flag.withDescription("Filtered JSONL path"),
    ),
  },
  Effect.fn("filterCommand")(function* (flags) {
    const report = yield* filterLanguageFile(flags);
    yield* Console.log(JSON.stringify(report, null, 2));
  }),
).pipe(
  Command.withDescription(
    "Copy JSONL lines for one language out of a multi-language dump",
  ),
);

const root = Command.make("dict-import").pipe(
  Command.withDescription(
    "Build a per-language SQLite dictionary from English Wiktionary (wiktextract)",
  ),
  Command.withSubcommands([importCommand, filterCommand]),
);

root.pipe(
  Command.run({ version: "0.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
