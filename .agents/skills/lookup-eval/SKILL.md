---
name: lookup-eval
description: Test whether the dictionary helps readers understand words in real text without showing them junk, by running lookups over the corpus, having synthetic learners judge a sample, and reviewing the findings. Use only when explicitly asked to run the lookup eval or compare dictionary quality, because it uses a lot of tokens.
---

# Lookup eval

Run this from the root of the server repo. It needs `bun`, the `claude` CLI logged in, the server running with the dictionary to test, and the private corpus at `../corpus`. If any is missing, stop and say so. `eval/README.md` explains the design.

## Steps

1. Choose a language pair, such as `pl_en`, and a run name, such as `after-links`.
2. Run `bun eval/collect.ts --texts ../corpus/<lang> --lang <pair> --out eval/out/<lang>`. Add `--base <url>` if the server isn't on the default port, 37421.
3. Pick the items:
   - After a server change, reuse the baseline's words: `bun eval/sample.ts --run eval/out/<lang> --name <run> --from <baseline>`.
   - With no baseline yet: `bun eval/sample.ts --run eval/out/<lang> --name <run> --frequent 700 --random 300`.
4. Run `bun eval/judge.ts --dir eval/out/<lang>/<run> --dry`. Tell the user how many batches it needs and that each costs about 20k tokens, then wait for them to confirm.
5. Run `bun eval/judge.ts --dir eval/out/<lang>/<run> --effort medium`. Saved verdicts are reused, so only changed popovers are judged.
6. Run `bun eval/score.ts --dir eval/out/<lang>/<run>`, adding `--base eval/out/<lang>/<baseline>` to compare. If items are unjudged, run step 5 again.
7. Review the results as described below, yourself or with the most capable model available.
8. Report the results. Do not commit or push unless asked.

## Review

The judge predicts what a reader would understand, and it can be wrong. So:

1. Read the not-understood items in `review.json`, and mark flags that are too picky.
2. Read a random sample of about 30 items rated `yes`, using `sample.json` and the verdicts, to catch what the judge missed.
3. Audit the `junk` flags. Pointer-like glosses are reliable. Other junk flags often aren't, so read a sample before trusting the score.
4. Treat `marginal` as a lead, not a result. It varies between repeat runs. Back it up with the dump's tags or frequency data before filtering anything.
5. For each serious finding, find the cause in the source data (`data/raw/<lang>.jsonl`, or the full dump) and the importer (`src/importer/`). Read the raw record's whole `glosses` array, because a sense can be nested. Decide whether it comes from Wiktionary, wiktextract, the importer, ranking or the client.
6. When comparing runs, list what got worse as well as what improved. A general rule can help these texts and hurt others.

## Report

Give the three scores (understood, junk and marginal senses, fit in first group and first sense), for the frequent and random parts separately, then the main causes and verified findings with examples. Say which claims you checked. Scores are not an estimate for all running text.

Never file anything with Wiktionary or wiktextract based on the judge alone. A person must verify it and approve filing it. Keep the texts themselves out of this repo and out of any report that leaves it.
