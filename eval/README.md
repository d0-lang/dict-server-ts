# Lookup eval

The point is to make lookup better. A lookup is good when the reader understands the text thanks to it, and isn't shown junk that diverts effort from understanding. Texts live in the private `dict-corpus` repo, next to this one, and stay out of this repo because many are copyrighted. Run outputs go to `eval/out`, which is ignored because they quote the texts.

Absence of data is easy to detect, but wrong data isn't, so synthetic learners judge the results. They already know the language, so they predict what a learner would take away. That's good for comparing two versions of the server, but the absolute scores aren't learner data.

The agent-ready version of this process, including the review, is in [`.agents/skills/lookup-eval/SKILL.md`](../.agents/skills/lookup-eval/SKILL.md).

## The loop

Change the server, restart it, then for that language:

```sh
bun eval/collect.ts --texts ../corpus/pl --lang pl_en --out eval/out/pl
bun eval/sample.ts --run eval/out/pl --name after --from base
bun eval/judge.ts --dir eval/out/pl/after --effort medium
bun eval/score.ts --dir eval/out/pl/after --base eval/out/pl/base
```

The server must be running. `--base` on `collect.ts` defaults to the Docker service on port 37421. `judge.ts` saves verdicts in `eval/out/<lang>/verdicts.jsonl`, keyed by word, sentence, popover and prompt, so only changed popovers cost tokens. Editing `judge-prompt.md` invalidates every verdict.

The first run for a language needs a baseline: `bun eval/sample.ts --run eval/out/pl --name base --frequent 700 --random 300`. For 1,000 items, expect about 0.8M tokens on your Claude login.

## The scores

- **Understanding:** the share of items rated `yes`. Trust yes against not-yes more than the grades below it.
- **Relevance:** the share of senses flagged `junk` or `marginal`. A word with many real meanings scores perfectly. `marginal` varies between repeat runs, and `junk` is reliable for pointer-like glosses but not much beyond them.
- **Order:** whether the sense that fits is in the first group, and whether it's the first sense.

The judge sees the popover as text, grouped the way the extension groups it, without pronunciation. `popover.ts` copies that grouping, so keep it in step with `groupEntries` in the extension.

Judges run through `claude -p` with no tools and only `judge-prompt.md` as the system prompt, which costs far less than subagents. A batch with no thinking is retried, because those judged measurably worse.

## Reading the results

Have a stronger model review `review.json` and a random sample of items rated `yes`, tracing problems back through the dump. Verify a finding before acting on it or reporting it upstream.

The sample is 700 items from the most frequent words, with 3 sentences each for the top 100, plus 300 from a random sample of the rest. Report the two parts separately. Neither is an estimate for all running text.
