---
name: add-language
description: Add a language pair to the dictionary, or improve one systematically. Profiles the language's quirks from data, builds a context benchmark (multi-word entries and separable verbs, from generated and blind-verified sentences) and a segments benchmark (compound splits against Wiktionary etymologies), then hill-climbs lookup rules against them with subagent review. Use only when asked to add or improve a language, because generation, verification and judging use a lot of tokens.
---

# Add a language

Run this from the root of the server repo. You are the developer agent: you define the language's profile and phrase types, write the rules, and decide what to accept. Subagents generate, verify and review. A person who reads the language is optional. Most languages won't have one, so every step must work without them, and their review is used where it exists.

The judge and the corpus tools live in the corpus repo: `../corpus/eval/README.md` and its `lookup-eval` skill (`../corpus/.agents/skills/lookup-eval/SKILL.md`) explain them. This skill uses the judge at milestones.

## Requirements

- `bun`, and the `claude` CLI logged in.
- The Wiktionary dump at `data/raw-wiktextract-data.jsonl` (or `.gz`).
- Texts in `../corpus/<lang>` for phrase sampling and the judge. Without them, skip the corpus steps and say so.
- Nothing is committed or pushed unless the user asks.

## Files

| File | What it holds |
|---|---|
| `languages/<lang>/profile.md` | The profile (quirks, phrase types, settings) and the iteration log |
| `languages/<lang>/gold/context.jsonl` | The context benchmark's verified cases. Generated sentences, not corpus text, so they belong in the repo |
| `apps/server/eval/out/<lang>/bench/<run>/` | Benchmark results per run: scores, per-case pass/fail, flips against the previous run |

The benchmark scripts are `apps/server/eval/context-bench.ts` and `apps/server/eval/segments-bench.ts` (`bun run bench:context`, `bun run bench:segments`, from the repo root). If they don't exist yet, write them first, language-independent, and use German and Polish to check them (see Calibration).

## Phase 0: Import and smoke test

1. Write `languages/<lang>/language.toml`, starting from the closest finished language's (Ukrainian from Russian, Czech from Polish, Dutch from German); the importer refuses a language without one. Then filter and import: `bun run filter --lang <lang> --input data/raw-wiktextract-data.jsonl --out data/raw/<lang>.jsonl`, then `bun run import --lang <lang> --input data/raw/<lang>.jsonl`.
2. Check normalisation against real text before anything else: diacritics that Wiktionary writes and texts don't (Russian stress marks), letter variants (`ё`/`е`), apostrophes, case rules (Turkish `İ/ı`, German nouns). If a common form doesn't match, fix `lookupKey` or the importer first, because every later number depends on it.
3. Measure corpus coverage: the share of tokens with any entry, and the 50 most frequent words without one. Look at those 50 and classify the causes.

## Phase 1: Profile

Write `languages/<lang>/profile.md`. Base every answer on counts from the dictionary file and the corpus, with your language knowledge as interpretation, not as the source.

**Quirks checklist.** Answer each item with evidence (counts, examples), or "not relevant" with a reason:

- Spelling: diacritics, letter variants, case rules, apostrophes.
- Tokens: are words separated by spaces? Are clitics or contractions written onto words (`dándose`, `l'homme`, `ins`)?
- Inflection: how rich, and how complete the dictionary's tables are (share of corpus tokens found only through `forms`).
- Compounds: written as one word? Which linking elements? How many entries have compound etymologies?
- Discontinuous verbs: separable particles (de, nl, hu), and where they go.
- Phrases: do words other than the verb inflect? How many multi-word entries have inflected multi-word forms? Does negation change case?
- Reflexives and clitics: which pronouns stand for a phrase's reflexive, and do they move away from the verb?
- Data: junk gloss patterns, form-of chains, names that collide with common words.

**Phrase types.** Sample about 300 multi-word entries, weighted toward those whose words occur together in the corpus. Define the language's types from what you find. For each type, write:

- **Membership:** how a phrase is assigned, by POS and shape, precisely enough for a script or subagent to apply.
- **Variants:** the forms to generate, the ones this language really uses (German verb idiom: verb split off in a main clause, subordinate clause, perfect tense; Polish: inflected verb, verb one word away, negated).
- **Hard negatives:** how the same words occur without the phrase meaning (literal use, chance co-occurrence, the verb belonging to another clause).
- **Quota:** how many phrases to sample.

Report the share of sampled entries that fit no type. Above about 10%, a type is missing. Separable verbs are a type when the language has them.

**Settings.** List the per-language settings the rules need (clause-bracket word order, separable verbs, reflexive pronouns, maximum gap, clause-ending conjunctions, compound linkers) and their values. Settings live in `languages/<lang>/language.toml` (keys and defaults: `spec/language.schema.json`); the profile records why each value was chosen, and the TOML keeps a one-line comment per value.

If a reader of the language is available, ask them to review the profile now. Otherwise, continue.

## Phase 2: Build the benchmarks

### Context benchmark

1. **Sample** phrases for each type by its quota, plus every multi-word entry whose senses have Wiktionary examples. Those examples are written by people. Add them with `"source": "wiktionary"`.
2. **Generate** with subagents, about 100 phrases per agent, several in parallel. Before starting, tell the user the number of agents and an estimate of about 30k output tokens each, and wait for confirmation. Each agent gets the profile's type definition and writes, per phrase, the type's variants as positive sentences and its hard negatives. Every case has:

   ```json
   {"id": "ru-0412-p2", "type": "light-verb", "variant": "negated", "lemma": "обратить внимание", "sentence": "…", "word": "…", "expect": "phrase", "gloss": "English translation of the sentence", "source": "generated"}
   ```

   `word` is the clicked word, written as in the sentence. `expect` is `phrase` or `not-phrase`.
3. **Verify** each finished batch in a fresh subagent that doesn't see `expect`. Per case it answers: is `lemma` used in this sentence in the dictionary entry's meaning (give it the entry's senses), and is the sentence natural? Keep the cases where the verifier agrees with `expect` and calls the sentence natural.
4. **Check disagreement** per type and variant. Above about 20%, the type or variant is unclear or can't be expressed naturally. Fix its definition and regenerate, rather than keep the survivors.
5. **Save** to `languages/<lang>/gold/context.jsonl`.

`context-bench.ts` runs every case through the lookup with the sentence as `context`, against the real dictionary file. A positive passes when an entry with `lemma` comes before the word's own entries. A negative passes when no entry with `lemma` appears. It reports, per type and variant, recall on positives, false positives on negatives, and the case ids that flipped since the previous run.

### Segments benchmark (compounding languages only)

`segments-bench.ts` reads the entries in `data/raw/<lang>.jsonl` with `af`, `affix` or `compound` etymology templates (`Kind` + `-er-` + `Garten`). For each, it splits the word with its own entry hidden and compares the parts and linking elements with the etymology. It reports the share of exact matches, the share where only the linker differs, and the share with no split. No LLM is involved.

## Phase 3: Baseline

1. Run both benchmarks and record them in the profile's log.
2. Run the `lookup-eval` skill (in `../corpus`) on 1,000 corpus items. It asks before spending tokens.

## Phase 4: Hill-climb

One change per iteration:

1. **Pick** the largest loss: the worst type and variant in the context benchmark, the most common segment mismatch, or the largest judge failure category.
2. **Diagnose** with failing cases, and change a setting or a rule. Prefer general rules to word lists.
3. **Run both benchmarks.** No type or variant may fall by more than noise, about 1 point, without an explanation.
4. **Diff the corpus:** collect again (`../corpus/eval/collect.ts`, or `replay.ts` and `diff.ts`), and list every word whose popover changed, with an English gloss of each side. A fresh subagent classifies each change as better, worse or same, with a reason. Every "worse" needs an explanation or a fix.
5. **Review the code** with a fresh subagent that gets only the diff and the problem it solves. It checks for correctness and overfitting: special cases shaped around the example, word lists, rules that only work on the benchmark.
6. **Accept or revert.** If accepted, add two or three hand-written unit tests on an in-memory dictionary (next to the feature, in its `<feature>.<lang>.test.ts`, e.g. `apps/server/src/lookup/features/phrases/phrases.ru.test.ts`; the words go in the language's fixture, `apps/server/src/lookup/testing/<language>.ts`): one case the rule fixes and one nearby case it must not break. Never turn benchmark cases into unit tests: some are wrong, and data updates would break them.
7. **Log** the iteration in the profile: the change, benchmark numbers before and after, and what got worse.

Run the judge after a group of accepted changes, not every iteration.

## Phase 5: Stop

Stop when all hold:

- Two iterations in a row gained less than noise on the worst type.
- Every remaining "worse" item in the diffs is explained.
- The judge's understood score is not below the previous milestone.

Until the first pilots set them, there are no absolute targets. Record per-type recall, false positives and segment matches, so later languages can be compared.

## Calibration and support tiers

Benchmarks built by models are only as good as the models' knowledge of the language. So:

- **Calibrate** the pipeline on a language that has a reader. They grade 50 random verified cases. Record the share that is right in this file. On German and Polish, also check that the benchmarks catch the known bugs (`ist an` → `an sein`, `Schwein haben` across a sentence, `niczego` → `to nic`, `Spitzen` as the verb).
- **Tiers:**
  - **Reviewed:** a reader checks the profile and samples.
  - **Model only:** major languages, if calibration on a comparable reviewed language was at least about 90% right.
  - **Not supported:** languages where verified cases can't be trusted.

  Write the tier in the profile.

Calibration results:

| Language | Graded cases | Right | Date |
|---|---|---|---|
| Russian (generated by Haiku, verified by Haiku) | 57 | 56 (98%); the one miss was an unnatural sentence, not a wrong label | 2026-11-05 |

## Report

Write an HTML report in `docs/`. It contains:
- the profile summary and the tier;
- baseline and final benchmarks per type;
- judge scores;
- accepted rules, with their unit tests;
- what got worse, and why it stays.

Corpus text stays out of the repo and every report: quote only dictionary phrases and generated sentences. Never file anything with Wiktionary or wiktextract based on models alone.
