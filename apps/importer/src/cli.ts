import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { languagePair } from "./transform/languages.ts";
import { RAW_DUMP_URL, importWiktextract, languageRules } from "./Importer.ts";

const command = Command.make(
  "import",
  {
    lang: Flag.String("lang").pipe(
      Flag.withDescription("wiktextract lang_code to import"),
      Flag.withDefault("pl"),
    ),
    input: Flag.String("input").pipe(
      Flag.withAlias("i"),
      Flag.withDescription(
        "wiktextract JSONL: local path or URL, plain or .gz; the raw all-language dump or a file already filtered to one language",
      ),
      Flag.withDefault(RAW_DUMP_URL),
    ),
    out: Flag.String("out").pipe(
      Flag.withAlias("o"),
      Flag.withDescription(
        "output SQLite file (default data/<lang>_en.sqlite)",
      ),
      Flag.optional,
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("overwrite the output file if it already exists"),
      Flag.withDefault(false),
    ),
    noFormOfFallback: Flag.Boolean("no-form-of-fallback").pipe(
      Flag.withDescription(
        "do not add form -> lemma rows from separate form-of entries",
      ),
      Flag.withDefault(false),
    ),
    dump: Flag.String("dump").pipe(
      Flag.withDescription(
        "the dump snapshot the input comes from (dump-2026-10-30), recorded in the file's meta",
      ),
      Flag.optional,
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("stop after this many lines of the language"),
      Flag.optional,
    ),
  },
  Effect.fn(function* ({
    lang,
    input,
    out,
    force,
    noFormOfFallback,
    dump,
    limit,
  }) {
    const rules = yield* languageRules(lang);
    const outPath = Option.getOrElse(
      out,
      () => `data/${languagePair(rules)}.sqlite`,
    );
    yield* Console.error(`importing ${lang} from ${input} into ${outPath}`);
    const stats = yield* importWiktextract({
      lang,
      input,
      out: outPath,
      force,
      formOfFallback: !noFormOfFallback,
      dump: Option.getOrUndefined(dump),
      limit: Option.getOrUndefined(limit),
      progressEvery: 20_000,
    });
    yield* Console.log(JSON.stringify(stats, null, 2));
  }),
).pipe(
  Command.withDescription(
    "Build data/<lang>_en.sqlite from a wiktextract (kaikki.org) JSONL dump",
  ),
);

command.pipe(
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
