---
name: add-language
description: Add a language pair to the dictionary, or improve one. Tier 1 makes it usable (language.toml, import, profile, grammar file) until the corpus judge passes the gates, where every common grammar word must be understood. Tier 2 makes it great (multi-word entries, compounds, language-specific rules), hill-climbed against a context benchmark and a segments benchmark. Use only when asked to add or improve a language, because generation and judging use a lot of tokens.
---

# Add a language

Run this from the root of the server repo. The corpus checks run from `../corpus`, where the eval lives (`../corpus/eval/README.md`). You are the developer agent: you read the data, write the importer fixes and rules, and decide what to accept. Haiku subagents judge, classify, generate and verify.

A person who reads the language is optional. Most languages won't have one, so every step works without them. Where a step is better with one, it says what to do without one.

A plain import with sane decisions gets most of the way: Russian reached 90% understood before any lookup rule. Getting from good to great is most of the effort, so the two tiers are separate, and tier 1 must pass before tier 2 starts. Russian's first tier-1 round (2026-11-05) took the common grammar words from 92.7% to 99.3%, and everything understood from 91.5% to 94%, in an afternoon.

## Requirements

- `bun`, and the `claude` CLI logged in.
- The Wiktionary dump at `data/raw-wiktextract-data.jsonl` (or `.gz`).
- The extension built in `../extension` (`bun run build`), and Chromium at `/usr/bin/chromium`. The corpus checks go through the real extension, so they test what a reader sees.
- Texts in `../corpus/<lang>`, or `yt-dlp` and network access to gather them: see Corpus.
- Nothing is committed or pushed unless the user asks.

Before spending tokens (generation, judging, classifying), tell the user the number of agents or batches and the estimated tokens, and wait for their go.

## Corpus

One corpus with two kinds of text, in roughly equal amounts:

- **spoken:** transcripts (videos, interviews, speeches). Genres ending in `-video`, `-interview`, `-speech`, `-podcast` or `-stream` count as spoken; `"type"` in `sources.json` overrides that.
- **written:** articles, news, wiki, guides.

Both size and variety count, and texts differ hugely in size (a two-hour podcast is 15,000 words, a government notice 200), so the targets are in words and in texts. For each kind (spoken and written):

- at least 30,000 words (more is better);
- at least 10 texts, from at least 5 genres;
- no single text over a quarter of that kind's words.

Common words are ranked by how many different 500-word stretches of text they occur in, so a few long texts let their topic words and names through. Say in the profile where the corpus falls short. Some odd words get into the common list either way. The cure is more varied texts, not more rules.

### Gathering texts

Count what the language already has first: `../corpus/sources.json` lists every text with its language and genre. Then propose sources to fill the gaps, and let the user pick, since they know what readers of the language actually read. The corpus repo files them (`../corpus/README.md`). Texts must be the source's own words: never use a tool that summarizes or rewrites, including web-fetch tools that answer with a summary of the page.

**Videos.** Search YouTube in the language, one query per genre the corpus lacks (cooking, history, tech reviews, interviews, vlogs, news), and list the candidates:

```sh
yt-dlp --flat-playlist --print "%(id)s|%(channel)s|%(duration)s|%(title)s" "ytsearch20:<query in the language>"
```

Keep a candidate only if:

- `yt-dlp --skip-download -J <url>` gives `language` = `<lang>`, and its `automatic_captions` has `<lang>-orig`. Those are the captions `repair.ts` downloads.
- It runs 5–40 minutes.
- It is mostly people talking (not music, or gameplay without commentary), and native speech (not dubbed, not read by a synthetic voice).
- It is at most two per channel, because one channel's catchphrases would otherwise rank as common words.

Show the user a table (title, channel, minutes, genre) and wait for their picks. Then follow the corpus repo's `repair-captions` skill (`../corpus/.agents/skills/repair-captions/SKILL.md`). It asks before spending tokens: about 60–100k per part.

**Written texts.**

- Wikipedia articles come as plain text from the API:

  ```sh
  curl -s -A "dict-corpus/0.1" "https://<lang>.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&formatversion=2&titles=<Title>"
  ```

  The text is in `query.pages[0].extract`.
- For other kinds (news, guides, blogs, interviews), the user gives links, or you propose sites for them to approve. Save the article's own text, without menus, comments or related links.

Save each text as `../corpus/inbox/<lang>-<topic>-<medium>-<url-encoded source url>.md` (topic and medium as in `../corpus/README.md`, e.g. `ru-history-wiki-…`). Then run `bun ingest.ts --dry-run` and `bun ingest.ts` in `../corpus`.

The corpus repo is private because many texts are under copyright. Never copy its texts into this repo.

## Where things go

| What | Where |
|---|---|
| The language's settings | `languages/<lang>/language.toml`, one comment per value saying why. Keys and defaults: `spec/language.schema.json` |
| Grammar words, irregular forms, abbreviations, set phrases English Wiktionary lacks | `languages/<lang>/grammar.tsv`, written by hand |
| The profile and the iteration log | `languages/<lang>/profile.md` |
| The context benchmark's verified cases | `languages/<lang>/gold/context.jsonl`. Generated sentences, not corpus text, so they belong in the repo |
| Benchmark results per run | `apps/server/eval/out/<lang>/bench/<run>/` (ignored by git) |
| Collections, samples, verdicts, overrides | `../corpus/eval/out/<lang>/` (ignored by git: big, and made from the texts) |
| A lookup rule | the feature it belongs to in `apps/server/src/lookup/features/` (phrases, hyphen-joined words, abbreviations, separable verbs, compounds), or a new feature file |
| An import rule | `apps/importer/src/transform/` (per entry) or `apps/importer/src/output/passes/` (after the whole dump) |
| Unit tests | next to the feature, in `<feature>.<lang>.test.ts`, on the in-memory dictionary in `apps/server/src/lookup/testing/<language>.ts` |

Rules are written for a mechanism, not for a language. A rule only one language needs today is still a feature named after what it does (negation changing the object's case, a verb leaving its particle at the end of the clause), switched on by a setting. Then the next language that works the same way only sets it. When a rule fits a family (the negative genitive in Slavic languages), say so in the setting's description, and check it on every language of the family that the dictionary has. Never test the language code in code.

A new setting goes in the `Language` schema (`packages/core/src/language.ts`). Give it a description and a default that leaves every other language as it is, run `bun run spec`, and set it in the languages that need it.

## Tier 1: usable

### 1. Import

1. Write `languages/<lang>/language.toml`, starting from the closest finished language's (Ukrainian from Russian, Czech from Polish, Dutch from German). The importer refuses a language without one. Check each setting against the data before you keep it.
2. `bun run filter --lang <lang> --input data/raw-wiktextract-data.jsonl --out data/raw/<lang>.jsonl`, then `bun run import --lang <lang> --input data/raw/<lang>.jsonl`.
3. Check normalization against real text before anything else: marks the dump writes and texts don't (stress, vowel points, macrons), letter variants (`ё`/`е`), apostrophes, case rules (Turkish `İ/ı`, German nouns). If a common form doesn't match, fix `lookupKey` or the importer first, because every later number depends on it. A `lookupKey` change needs a new `SCHEMA_VERSION` and a vector in `spec/dictionary/lookup-key.jsonl`.

### 2. Profile

Write `languages/<lang>/profile.md`. Base every point on counts from the dictionary file and the corpus, with your language knowledge as interpretation, not as the source. Every point ends in a decision: fixed (how), a data gap (it goes on the hand-patch list), or not relevant (why). Don't keep findings that lead nowhere.

Check at least:

- **Spelling: what's matched and what's shown.** Matching ignores marks texts don't write (`lookupKey`). The lemma the reader sees keeps every mark the dump has (`import.stressedLemmas`).
- **The headword.** The lemma is what a learner copies into their head, so it shows what they need to use the word, not just its spelling: stress for Russian (`соба́ка`), the article or gender for nouns where it isn't predictable (German `der Hund`), and whatever else the language needs (aspect partners, irregular plurals). The importer stores a noun's or verb's gender, animacy, aspect and plural-only as grammar features (`packages/core/src/features.ts`). Check how many of the language's nouns and verbs get them, and where its lines keep those tags. `[headword]` in `language.toml` decides how they show: as `labels` (`f`, `anim`, `pf`), or as an article in the lemma (`articles`, German). Grammar the features don't cover yet needs a new feature, or a protocol change if it needs a field of its own; ask the user before a protocol change.
- **Tokens.** What the extension's word splitter does with hyphens, periods inside abbreviations and apostrophes, and whether clitics or contractions are written onto words (`dándose`, `l'homme`, `ins`). The clicked word is whatever the splitter gives.
- **Coverage.** The share of corpus words with any entry, and the 50 most frequent words without one, each with its cause.
- **Grammar words and irregular forms.** Wiktionary's pronoun and preposition entries are often shared tables, or wrong for a reader. Grammar words go in `grammar.tsv`. So do irregular forms a reader can't connect to their base (`был` "was", `будет` "will be", `мог` "could"), as entries of their own: the protocol has no inflection tables, and doesn't need them. A line with a content part of speech (`здесь ADV`) replaces Wiktionary's entry of that part of speech, for a sense Wiktionary lacks.
- **Ranking.** What opens the popover for the commonest words (letters, abbreviations, or names before the word).
- **Structure.** Compounds written as one word (linking elements, entries with compound etymologies); separable particles and where they go; negation that changes case; reflexives that move away from the verb; reflexive verbs a learner learns with their particle (`bawić się`: `import.reflexive`, `context.reflexiveParticles`); a verb bracket. Each one that applies is a setting in `language.toml`, and the profile records why each value was chosen.
- **What the general rules do here.** These already work for every language; check them on the new one: comparatives and superlatives as entries of their own (`лучше`, `besser`; a comparative spelled like a plain form of its base stays with the base, `neuer`), pieces of dotted abbreviations (`т` in `т.д.`, `z` in `z.B.`), endings after numbers (`3-го`), hyphen-joined words, negation, commas in conjunctions.

If a reader of the language is available, give them a review page for the profile and the grammar file (`bun ../corpus/eval/review/build.ts --lang <lang> --name <Language> --out <file>`): a tick per item, and a download of what they don't agree with. Only ask them what changes a result, and decide small things yourself.

### 3. Collect, sample, judge

Start the server with the new dictionary (`LANGUAGES=<pair> PORT=<port> bun run start`). Then, in `../corpus`:

```sh
bun eval/collect.ts --texts <lang> --lang <pair> --base <url> --out eval/out/<lang>/<run> --every-word
bun eval/sample.ts --run eval/out/<lang>/<run> --name gate --strategy gate --common 1000 --random 1000
bun eval/collect-browser.ts --texts <lang> --lang <pair> --server <url> --sample eval/out/<lang>/<run>/gate/sample.json
bun eval/judge.ts --dir eval/out/<lang>/<run>/gate --dry      # tell the user the batches and tokens, then wait
bun eval/judge.ts --dir eval/out/<lang>/<run>/gate --effort medium
bun eval/score.ts --dir eval/out/<lang>/<run>/gate
```

- Two collections, for two jobs:
  - `collect.ts` sends every word of every text to the server API, split like the extension splits it (about 1.5 minutes for 77k words). It is cheap enough to run after every change, so it is the base for the sample (word frequencies, spoken or written, position) and for every diff.
  - `collect-browser.ts` does the same through the real extension in headless Chromium, which is what a reader sees, but slowly, so it runs on the sample.
- The browser run must show the same word, sentence and popover as the API run. Any difference is reported and must be explained before judging (`../corpus/eval/README.md`). When they differ, change `collect.ts` to do what the extension does, never the reverse: the Russian check found that Chromium splits words at a period between letters (`т.д` → `т`), and that the extension sends no sentence longer than 500 characters. Run a full browser collection (`collect-browser.ts` without `--sample`, about 20 minutes for 77k words) once per new language and after any extension change.
- Judging the first sample (about 2,200 items) took Haiku about 25 minutes and about 4% of a 5-hour Claude usage window, with the default 5 parallel calls. More calls (`--concurrency 10` on `judge.ts` and `classify.ts`) should cut the time without costing more: the batches and their tokens stay the same. The limit is the account's rate limit, and `--attempts` retries a failed batch. Measured on Polish (2026-11-06, 2,188 items, 88 batches): 8.5 minutes with `--concurrency 10`, against about 25 minutes with 5 for a Russian sample of the same size, with 35 retried batches; the judge's own tally put the cost at $0.80.
- Verdicts are cached per language by word, sentence and popover, so later runs only judge what changed.
- The sample is fixed at the first run and reused (`--from`), so runs compare:
  - **common:** the 1,000 most widely used words, spoken and written weighed equally, names left out. The top 100 get up to 3 sentences.
    - **grammar** words: any entry that isn't a noun, verb or adjective, or no entry at all (`и`, `по`, `уже`, `нибудь`).
    - **content** words: only noun, verb or adjective entries.
  - **random:** 1,000 more words, half spoken and half written.

### 4. Gates

| Gate | Needs |
|---|---|
| Common grammar words | 100% understood |
| Common content words | 95% |
| Random words | 90% |

A beginner meets the common words first, so they mustn't get lost there. You read every failing common word yourself (or a stronger model does), and so does the user, if they read the language:

- **A real miss:** fix it (grammar file, importer, ranking). In Russian the misses fell into a few groups, each with one fix:
  - forms of "to be" and modals;
  - comparatives;
  - prepositions missing a sense;
  - abbreviations;
  - endings after numbers;
  - set phrases English Wiktionary lacks (`в принципе`, `за счёт`, `по словам`), which go in the grammar file as phrase lines for a reader to review.
- **Not the word's own entry's job:** add it to `../corpus/eval/out/<lang>/overrides.jsonl` with the reason, after the user approves it (or, with no user, list it in the report for them). Overrides are listed in every report. Approved Russian examples:
  - the meaning comes from a governing verb or idiom the word is only part of (`относиться к`, `ни перед чем не`);
  - a plural read as its singular (`тысячи`);
  - comparatives shown as "comparative degree of хороший: good", which is how the dictionary labels them.

### 5. Iterate on tier 1

After each change, in `../corpus`: collect again through the API (`collect.ts … --every-word`), then

```sh
bun eval/diff.ts --before eval/out/<lang>/<old> --after eval/out/<lang>/<new> --out eval/out/<lang>/<new>/changes.jsonl --per-change 3 --sample eval/out/<lang>/<old>/gate/sample.json
bun eval/classify.ts --changes eval/out/<lang>/<new>/changes.jsonl
bun eval/sample.ts --run eval/out/<lang>/<new> --name gate --from ../<old run>/gate   # same items, today's popovers
bun eval/judge.ts … && bun eval/score.ts …   # only changed popovers are judged again
```

- `--per-change 3` keeps 3 sentences for each word whose popover changed the same way: a sense added to a preposition changes a thousand popovers alike. Russian's first round went from 4,400 changes to rate down to 880.
- An importer change needs a re-import, and a running server keeps the old file open, so restart it. For a "before" run, back up the dictionary files to a folder and serve them from a second port: `DATA_DIR=<folder> PORT=<port> bun run start`.
- Most rules apply to every language, so collect and diff every language a change touches, not just the new one. The German diff was where comparatives spelled like plain adjectives (`ein neuer Film`) showed up.
- Every "worse" in the classified diff needs a fix or an explanation. The classifier can be wrong too (it rated a fix "worse" while saying it was better), so read them.
- Every accepted change gets unit tests that fail without it.

Tier 1 is done when all three gates pass.

## Tier 2: great

Only after tier 1 passes. This is where most of the effort goes, and where the features that set the dictionary apart come from: idioms found in context, compounds split, odd forms resolved.

### 1. Find the losses

Multi-word entries (idioms, verb phrases, compound conjunctions), forms that behave oddly, anything language-specific. The judge's `fixed_phrase` and `form_gloss` misses and the profile point to them.

### 2. Build the benchmarks

**Phrase types.** Sample about 300 multi-word entries, weighted toward those whose words occur together in the corpus, and define the language's types from what you find. For each type, write in the profile:

- **Membership:** how a phrase is assigned, by POS and shape, precisely enough for a script or a subagent to apply.
- **Variants:** the forms this language really uses (German verb idiom: verb split off in a main clause, subordinate clause, perfect tense; Polish: inflected verb, verb one word away, negated).
- **Hard negatives:** how the same words occur without the phrase meaning (literal use, chance co-occurrence, the verb belonging to another clause).
- **Quota:** how many phrases to sample.

Report the share of sampled entries that fit no type. Above about 10%, a type is missing. Separable verbs are a type when the language has them.

**Context benchmark** (`bun run bench:context --lang <lang> --run <run>`):

1. **Start with the dump's own example sentences** for multi-word entries. They are written by people, free, and need no grading. Add them with `"source": "wiktionary"`.
2. **Generate** sentences only for the variants the examples lack (verb apart from its phrase, negated, another word order), with Haiku subagents, about 100 phrases per agent, several in parallel. Ask the user first (about 30k output tokens per agent). Each agent gets the type's definition and writes the type's variants as positives and its hard negatives:

   ```json
   {"id": "ru-0412-p2", "type": "light-verb", "variant": "negated", "lemma": "обратить внимание", "sentence": "…", "word": "…", "expect": "phrase", "gloss": "English translation of the sentence", "source": "generated"}
   ```

   `word` is the clicked word, written as in the sentence. `expect` is `phrase` or `not-phrase`.
3. **Filter by script** before verifying: every word of the lemma is present in some form, the clicked word is a content word of the lemma, and proverbs are not inflected.
4. **Verify** each batch in a fresh subagent that doesn't see `expect`. Per case it answers two questions: is `lemma` used in this sentence in the entry's meaning (give it the entry's senses), and is the sentence natural? Keep the cases where the verifier agrees with `expect` and calls the sentence natural.
5. **Check disagreement** per type and variant. Above about 20%, the type or variant is unclear or can't be said naturally: fix its definition and regenerate, rather than keep the survivors.
6. **Grade** a random sample, and a sample of the failing cases (where wrong cases gather), if a reader is available. Mark a wrong case `invalid` with a reason. Never edit a case to make a rule pass.
7. **Save** to `languages/<lang>/gold/context.jsonl`.

A positive passes when an entry with `lemma` comes before the clicked word's own entries. A negative passes when no entry with `lemma` appears. The bench reports recall and false positives per type and variant, and the cases that flipped since the previous run.

**Segments benchmark** (compounding languages only; `bun run bench:segments --lang <lang> --run <run>`): it reads the entries in `data/raw/<lang>.jsonl` whose etymology is a compound (`Kind` + `-er-` + `Garten`), splits each word with its own entry set aside, and compares the parts with the etymology. The headline number is precision: how many of the splits made are right. No LLM is involved.

Record both baselines in the profile's log.

### 3. Hill-climb

One change per iteration:

1. **Pick** the largest loss: the worst type and variant in the context benchmark, the most common segment mismatch, or the largest judge failure category.
2. **Diagnose** with failing cases, and change a setting or a rule (see Where things go). Prefer general rules to word lists.
3. **Run both benchmarks.** No type or variant may fall by more than noise (about 1 point) without an explanation.
4. **Collect and diff the corpus**, for every language the change touches (tier 1, step 5). Every "worse" needs a fix or an explanation.
5. **Review the code** with a fresh subagent that gets only the diff and the problem it solves. It checks for correctness and overfitting: special cases shaped around the example, word lists, rules that only work on the benchmark.
6. **Accept or revert.** If accepted, add two or three hand-written unit tests (see Where things go): one case the rule fixes, and one nearby case it must not break. Never turn benchmark cases into unit tests: some are wrong, and data updates would break them.
7. **Log** the iteration in the profile: the change, the benchmark numbers before and after, the corpus diff, and what got worse.

Run the judge after a group of accepted changes, not every iteration.

### 4. Stop

Stop when all of these hold:

- Two iterations in a row gained less than noise on the worst type.
- The worst remaining failures are all sorted into benchmark noise, rejected fixes and data gaps.
- Every remaining "worse" item in the diffs is explained.
- The gates still pass, and the judge's understood score is not below the previous milestone.

There are no absolute targets yet. Record per-type recall, false positives and segment precision, so later languages can be compared.

Words English Wiktionary lacks go on the profile's hand-patch list. Never file anything with Wiktionary or wiktextract based on models alone.

## Calibration and support tiers

Benchmarks built by models are only as good as the models' knowledge of the language. So:

- **Calibrate** the pipeline on a language that has a reader: they grade 50 random verified cases. Record the share that is right in the table below. On German and Polish, also check that the benchmarks catch the known bugs (`ist an` → `an sein`, `Schwein haben` across a sentence, `niczego` → `to nic`, `Spitzen` as the verb).
- **Tiers** (write the language's tier in its profile):
  - **Reviewed:** a reader checks the profile and samples.
  - **Model only:** major languages, if calibration on a comparable reviewed language was at least about 90% right.
  - **Not supported:** languages where verified cases can't be trusted.

| Language | Graded cases | Right | Date |
|---|---|---|---|
| Russian (generated by Haiku, verified by Haiku) | 57 | 56 (98%); the one miss was an unnatural sentence, not a wrong label | 2026-11-05 |

## Report

Write an HTML report in `docs/` (Russian's is `docs/ru-report.html`). It contains:

- the profile summary and the tier;
- the gates before and after, and the judge scores;
- the baseline and final benchmarks per type;
- the accepted rules, with their unit tests;
- what got worse, and why it stays;
- the overrides and the hand-patch list.

Quote only dictionary phrases and generated sentences, never corpus text.
