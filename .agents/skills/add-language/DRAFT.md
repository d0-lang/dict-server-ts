---
name: add-language
description: (DRAFT, not in use yet; SKILL.md is the current version.) Add a language pair to the dictionary, or improve one. Tier 1 makes it usable: import, profile, grammar file, settings, until the corpus judge passes the gates (every common grammar word understood). Tier 2 makes it great: multi-word entries, odd forms and language-specific rules, hill-climbed against a context benchmark. Use only when asked to add or improve a language, because judging uses a lot of tokens.
---

# Add a language (draft)

Run this from the root of the server repo; the corpus checks run from `../corpus`, where the eval lives (`../corpus/eval/README.md`). You are the developer agent: you read the data, write the importer fixes and rules, and decide what to accept. Haiku agents judge, classify and generate. A person who reads the language is optional, but some steps are better with one; each such step says what to do without one.

A plain import with sane decisions gets most of the way: Russian reached 90% understood before any lookup rule. Getting from good to great is most of the effort, so the two tiers are separate, and tier 1 must pass before tier 2 starts. Russian's first tier-1 round (2026-11-05) took the common grammar words from 92.7% to 99.3% and everything understood from 91.5% to 94%, in an afternoon.

## Requirements

- `bun`, and the `claude` CLI logged in.
- The Wiktionary dump at `data/raw-wiktextract-data.jsonl` (or `.gz`).
- The extension built in `../extension` (`bun run build`) and Chromium at `/usr/bin/chromium`. All corpus checks go through the real extension, so they test what a reader sees.
- Texts in `../corpus/<lang>`: see Corpus.
- Nothing is committed or pushed unless the user asks.

## Corpus

One corpus with two kinds of text, in roughly equal amounts:

- **spoken:** transcripts (videos, interviews, speeches). Genres ending in `-video`, `-interview`, `-speech`, `-podcast` or `-stream` count as spoken; `"type"` in `sources.json` overrides that.
- **written:** articles, news, wiki, guides.

Variety matters more than size. Common words are ranked by how many different stretches of text they occur in, so a corpus of a few long texts lets topic words and names through. Aim for at least 10 texts of each kind across several genres; say so in the profile if there are fewer. Some odd words get into the common list either way; the cure is more varied texts, not more rules.

## Files

| File | What it holds |
|---|---|
| `docs/languages/<lang>.md` | The profile (quirks, settings, decisions) and the iteration log |
| `src/importer/grammar/<lang>.tsv` | Written by hand: grammar words, irregular forms, abbreviations, and set phrases English Wiktionary lacks |
| `../corpus/eval/out/<lang>/` | Collections, samples, verdicts, overrides (ignored by git: big, and made from the texts) |
| `eval/gold/<lang>/context.jsonl` | Tier 2's context benchmark (generated sentences, so it can be in the repo) |

## Tier 1: usable

### 1. Import

`bun run filter --lang <lang> …`, then `bun run import --lang <lang> …`. Start from the settings of the closest finished language (Ukrainian from Russian, Czech from Polish, Dutch from German) and check each one against the data.

### 2. Profile

Write `docs/languages/<lang>.md`. Base every point on counts from the dictionary file and the corpus. Every point ends in a decision: fixed (how), a data gap (goes to the hand-patch list), or not relevant (why). Don't keep findings that lead nowhere.

Check at least:

- **Spelling: what's matched and what's shown.** Marks the dump has and texts don't (stress, vowel points, macrons), letter variants (`ё`/`е`), apostrophes, case. Matching ignores them (`lookupKey`); the lemma the reader sees keeps every mark the dump has.
- **Tokens.** What the extension's word splitter does with hyphens, periods inside abbreviations and apostrophes. The clicked word is whatever it gives.
- **Coverage.** Share of corpus words with any entry; the 50 most frequent words without one, each with its cause.
- **Grammar words and irregular forms.** Wiktionary's pronoun and preposition entries are often shared tables or wrong for a reader. Grammar words go in `<lang>.tsv`. So do irregular forms a reader can't connect to their base (`был` "was", `будет` "will be", `мог` "could"), as entries of their own: the protocol has no inflection tables, and doesn't need them. A line with a content part of speech (`здесь ADV`) replaces Wiktionary's entry of that part of speech, for a sense Wiktionary lacks.
- **Ranking.** What opens the popover for the commonest words (letters, abbreviations, names before the word).
- **What the general rules do here.** These already work for every language; check them on the new one: comparatives and superlatives as entries of their own (`лучше`, `besser`; a comparative spelled like a plain form of its base stays with the base, `neuer`), pieces of dotted abbreviations (`т` in `т.д.`, `z` in `z.B.`), endings after numbers (`3-го`), hyphen-joined words, negation, commas in conjunctions.

If a reader of the language is available, give them a review page for the profile and the grammar file (`bun ../corpus/eval/review/build.ts --lang <lang> --name <Language> --out <file>`): a tick per item, and a download of what they don't agree with. Only ask them what changes a result. Decide small things yourself.

### 3. Collect, sample, judge

In `../corpus`:

```sh
bun eval/collect.ts --texts <lang> --lang <pair> --base <url> --out eval/out/<lang>/<run> --every-word
bun eval/sample.ts --run eval/out/<lang>/<run> --name gate --strategy gate --common 1000 --random 1000
bun eval/collect-browser.ts --texts <lang> --lang <pair> --server <url> --sample eval/out/<lang>/<run>/gate/sample.json
bun eval/judge.ts --dir eval/out/<lang>/<run>/gate --dry      # tell the user the batches and tokens, then wait
bun eval/judge.ts --dir eval/out/<lang>/<run>/gate --effort medium
bun eval/score.ts --dir eval/out/<lang>/<run>/gate
```

- Every word goes through the server API, split like the extension splits it (about 1.5 minutes for 77k words).
- The sampled words also go through the real extension in headless Chromium. It must show the same word, sentence and popover; any difference is reported and must be explained before judging (`../corpus/eval/README.md`). When they differ, change `collect.ts` to do what the extension does, never the reverse: the Russian check found that Chromium splits words at a period between letters (`т.д` → `т`) and that the extension sends no sentence longer than 500 characters. A full browser collection (`collect-browser.ts` without `--sample`, about 20 minutes for 77k words) is worth running once per new language and after any extension change.
- Judging the first sample (about 2,200 items) took Haiku about 25 minutes and about 4% of a 5-hour Claude usage window. Verdicts are cached per language by word, sentence and popover, so later runs only judge what changed.
- The sample is fixed at the first run and reused (`--from`) so runs compare:
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

A beginner meets the common words first, so they mustn't get lost there. Every failing common word is read by you (or a stronger model) and the user where one reads the language:

- a real miss: fix it (grammar file, importer, ranking). In Russian the misses fell into a few groups, each with one fix: forms of "to be" and modals, comparatives, prepositions missing a sense, abbreviations, endings after numbers, and set phrases English Wiktionary lacks (`в принципе`, `за счёт`, `по словам`), which go in the grammar file as phrase lines for a reader to review;
- not the word's own entry's job: add it to `eval/out/<lang>/overrides.jsonl` with the reason, after the user approves it (or, with no user, list it in the report for them). Approved Russian examples: the meaning comes from a governing verb or idiom the word is only part of (`относиться к`, `ни перед чем не`), a plural read as its singular (`тысячи`), and comparatives shown as "comparative degree of хороший: good", which is how the dictionary labels them. Overrides are listed in every report.

### 5. Iterate on tier 1

After each change, in `../corpus`: collect again through the API (`collect.ts … --every-word`), then

```sh
bun eval/diff.ts --before eval/out/<lang>/<old> --after eval/out/<lang>/<new> --out eval/out/<lang>/<new>/changes.jsonl --per-change 3 --sample eval/out/<lang>/<old>/gate/sample.json
bun eval/classify.ts --changes eval/out/<lang>/<new>/changes.jsonl
bun eval/sample.ts --run eval/out/<lang>/<new> --name gate --from ../<old run>/gate   # same items, today's popovers
bun eval/judge.ts … && bun eval/score.ts …   # only changed popovers are judged again
```

- `--per-change 3` keeps 3 sentences for each word whose popover changed the same way: a sense added to a preposition changes a thousand popovers alike. Russian's first round went from 4,400 changes to rate to 880.
- Importer changes need a re-import, and a running server keeps the old file open, so restart it. For a "before" run, serve the backed-up dictionary files from a second port, from a folder whose `data/` links to them.
- Most rules apply to every language, so collect and diff every language a change touches, not just the new one. The German diff was where comparatives spelled like plain adjectives (`ein neuer Film`) showed up.
- Every "worse" in the classified diff needs a fix or an explanation. The classifier can be wrong too (it rated a fix "worse" while saying it was better), so read them.
- Every accepted change gets unit tests that fail without it.

Tier 1 is done when all three gates pass.

## Tier 2: great

Only after tier 1 passes. This is where most of the effort goes, and where the features that set the dictionary apart come from: idioms found in context, compounds split, odd forms resolved.

1. **Find the losses.** Multi-word entries (idioms, verb phrases, compound conjunctions), forms that behave oddly, anything language-specific. The judge's `fixed_phrase` and `form_gloss` misses and the profile point to them.
2. **Context benchmark.** Start with the dump's own example sentences for multi-word entries: written by people, free, no grading needed. Generate sentences (Haiku, blind-verified) only for variants the examples lack (verb apart from its phrase, negated, another word order), and filter them by script before verifying: every word of the lemma present in some form, the clicked word a content word of the lemma, proverbs not inflected. If a reader is available, have them grade a random sample and a sample of the failing cases, where wrong cases gather. Mark wrong cases `invalid` with a reason; never edit a case to make a rule pass.
3. **Hill-climb**, one change at a time: pick the biggest loss, change a setting or a general rule, run the benchmark, collect and diff the corpus, have a fresh agent review the code for overfitting, accept or revert, add 2–3 unit tests, log it in the profile. Try each rule on every language it could apply to, and switch it on only where it helps.
4. **Stop** when the worst remaining failures are all sorted into benchmark noise, rejected fixes and data gaps, and the gates still pass.

Words English Wiktionary lacks go in the profile's hand-patch list. Never file anything with Wiktionary or wiktextract based on models alone.

## Report

An HTML report in `docs/`: the profile summary, the gates before and after, accepted rules with their tests, what got worse and why it stays, and the hand-patch list. Quote only dictionary phrases and generated sentences, never corpus text.
