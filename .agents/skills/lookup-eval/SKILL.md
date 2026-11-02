---
name: lookup-eval
description: Test whether the dictionary helps readers understand words in real text, by running lookups over the corpus, having LLM workers judge a sample, and reviewing the findings. Use only when explicitly asked to run the lookup eval or compare dictionary quality, because it uses a lot of tokens.
---

# Lookup eval

Run this from the root of the server repo. It needs `bun`, the server running with the dictionary to test, and the private corpus at `../corpus`. If either is missing, stop and say so. `eval/README.md` explains the design.

The question for each word is: after reading this popover, does the reader understand the word in this sentence?

## Steps

1. Choose a language pair, such as `pl_en`, and a run name, such as `run-2`. To compare with an earlier run, reuse its sample size and `--seed`.
2. Run `bun eval/collect.ts --texts ../corpus/<lang> --lang <pair> --out eval/out/<lang>`. Add `--base <url>` if the server isn't on the default port, 37421.
3. Run `bun eval/sample.ts --run eval/out/<lang> --name <run> --batches 5 --size 40`.
4. Tell the user the batch count and that each costs about 60k tokens, then wait for them to confirm.
5. Judge each `batch-NN.json` using the worker prompt below.
6. Run `bun eval/score.ts --dir eval/out/<lang>/<run>`. If a batch has no verdicts or doesn't cover all its items, redo it with a fresh worker.
7. Review the results as described below, yourself or with the most capable model available.
8. Report the results. Do not commit or push unless asked.

## Workers

Give each batch its own worker, in parallel if possible, using a fast, inexpensive model such as Claude Haiku. Each worker should start with a fresh context and see only its own batch.

Worker prompt, with the paths filled in:

> Read `eval/judge-prompt.md` and follow it exactly. The input is `eval/out/<lang>/<run>/batch-NN.json`. Write your JSON array to `eval/out/<lang>/<run>/batch-NN-verdicts.json`. Do not open any other file, run code or look anything up. When finished, reply with one line: how many items you wrote.

If your environment has no subagents, judge the batches yourself, one at a time.

## Review

The judge predicts what a reader would understand, and it can be wrong. It tends to be picky about near-synonyms and can't say why something went wrong. So:

1. Read everything in `review.json`, and mark flags that are too picky.
2. Read a random sample of about 30 items rated Clear, using `sample.json` and the verdicts, to catch what the judge missed.
3. For each serious finding, find the cause in the source data (`data/raw/<lang>.jsonl`, or the full dump) and the importer (`src/importer/`). Decide whether it comes from Wiktionary, wiktextract, the importer, ranking or the client.
4. When comparing runs, list what got worse as well as what improved. A general rule can help these texts and hurt others.

## Report

Give the share rated Clear per genre, the main causes and verified findings with examples, and say which claims you checked. Say how small the sample is: it takes the same number of words per genre and favours frequent words, so it isn't an estimate for all running text.

Never file anything with Wiktionary or wiktextract based on the judge alone. A person must verify it and approve filing it. Keep the texts themselves out of this repo and out of any report that leaves it.
