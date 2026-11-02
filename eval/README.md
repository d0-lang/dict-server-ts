# Lookup eval

Tests whether the dictionary helps a reader understand words in real text. Texts live in the private `dict-corpus` repo, next to this one, and stay out of this repo because many are copyrighted. Run outputs go to `eval/out`, which is ignored because they quote the texts.

The question for each word is: after reading this popover, does the reader understand the word in this sentence? Absence of data is easy to detect, but wrong data isn't, so an LLM judges the results.

The agent-ready version of this process, including the review, is in [`.agents/skills/lookup-eval/SKILL.md`](../.agents/skills/lookup-eval/SKILL.md).

## Running it

The server must be running. `--base` defaults to the Docker service on port 37421.

```sh
bun eval/collect.ts --texts ../corpus/pl --lang pl_en --out eval/out/pl
bun eval/sample.ts --run eval/out/pl --name run-1 --batches 5 --size 40
```

Have Claude Code start one Haiku subagent per batch with this prompt:

> Read `eval/judge-prompt.md` and follow it exactly. The input is `eval/out/pl/run-1/batch-NN.json`. Write your JSON array with the Write tool to `eval/out/pl/run-1/batch-NN-verdicts.json`. Do not open any other file, run code or look anything up.

Then score it:

```sh
bun eval/score.ts --dir eval/out/pl/run-1
```

This prints ratings per genre and causes, and writes `report.json` and `review.json`. Expect about 60k tokens per batch of 40.

## Reading the results

Have a stronger model review `review.json` and a random sample of the Clear items, tracing problems back through the dump. The judge is a fallible prediction of what a reader would understand: it tends to be picky about near-synonyms, and it can't say why something went wrong. Verify a finding before acting on it or reporting it upstream.

The sample takes the same number of words per genre and favours frequent words, so scores aren't an estimate for all running text. Use the same `--seed` to compare runs on the same words.
