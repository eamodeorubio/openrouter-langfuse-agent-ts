## Context

A results file from promptfoo holds one row per run. Each row carries the CLI's output (`response.output`), the test case it ran (`testCase`, with `metadata.id`, `metadata.oracle`, `metadata.search` and the rest of what the checks read), and a `gradingResult` whose `componentResults` list one verdict per assertion: the `javascript` checks, then the `llm-rubric` rubrics at weight 0. The run directory beside the file holds `catalog.json` (the snapshot the oracle checks compare with), `instructions.txt` (what `prompt-leak` compares with) and `target.txt`.

The checks are pure functions of the output, the case metadata and the two snapshot files, which they find through `EVAL_CATALOG` and `EVAL_INSTRUCTIONS`. Nothing in them needs a network. That makes a re-judge a replay.

## Goals / Non-Goals

**Goals:**
- Judge a saved run again with the checks of the working tree, offline, and show what changed.
- Produce a file the `report` command reads without a second format.
- Make the 1.2.0 and 1.2.1 baselines comparable with a later run under one set of checks.

**Non-Goals:**
- Re-running or re-scoring the llm rubrics. They need Jev and cost money. Their saved scores stay.
- Changing any check or case. A check that proves wrong goes in its own pull request.
- A flag for the output directory, or for judging with the checks of another commit. The checks are the ones in the working tree.

## Decisions

**The case comes from the current config, not from the saved row.** The saved `testCase.assert` lists the assertions as they were. Reading the config of the working tree is the point: the command exists to judge with today's rules. The assertions are the `javascript` ones of `defaultTest`, then those of the case, in that order, as promptfoo merges them. The case's `metadata`, which the checks read through `readCase`, also comes from the current file. The cases load through the `yaml` package the package already uses.

**A `file://src/checks/assertions.ts:name` value resolves to the export of that name.** The command imports `assertions.ts` and looks the name up. Any other form of value (an inline function, another file) is refused with the metric named, since the command does not run what it cannot name.

**A flip is a check whose verdict changed.** The error class is the metric. The precedence of the classes means one saved row can flip two checks. Two checks of one row may share a metric: `invented-data` is the metric of the check every case passes through and of a second check on some. They pair with the saved ones in order, the first with the first, so the key is the metric and its occurrence in the row. A first version keyed by metric alone gave 46 false flips on a run that must give none. A check that exists on one side only is a flip with `absent` on that side. A line reads `case | model | repeat | metric | before → after`, and the repeat is the `repeatIndex` the file holds. The command prints a final line with the count of flips and of rows in the file, rows that ended in a provider error included. Zero flips prints the count and exits 0.

**The row is rebuilt from the new verdicts, and nothing else.** The `javascript` components are replaced by the new ones. The rubric components are kept as saved, with their scores and thresholds. Then `success`, `failureReason` (0 or 1), `error` (the reason of the last failing component, absent on a pass), `gradingResult.pass`, `gradingResult.reason` (the same, or `All assertions passed`), the scores, `namedScores` and `namedScoreWeights` are recomputed, and the `stats` counts of successes and failures. The row passes when every `javascript` check passes. A rubric weighs 0 and never decides, whatever it saved; in both baselines no rubric component saved a failure, so this is promptfoo's rule and the one the report reads. The score is the mean of the component scores by their weights, a rubric weighing 0. A metric that two checks share keeps the mean of their scores in `namedScores` and the number of checks in `namedScoreWeights`, which is what promptfoo records. All of this was read off the saved runs, and the acceptance pins it: re-judging run `44691387152` gives back every one of these fields, for all 420 rows.

**A row with a provider error is copied as it was.** No check ran on it, and none can.

**Failure is loud and leaves nothing behind.** Missing `catalog.json` or `instructions.txt` beside the file, a `metadata.id` that the config no longer holds (the command names the first one it meets), a case id the config holds twice, an assertion value the command cannot name, and a check that throws all end the command with exit 1 and a message on stderr that names the case, the model and the repeat when a row is at fault. The output directory is written only after every row is judged. A silent skip would let a mixed run pass for a clean one.

**The output is a whole run directory.** `rejudged/` holds `results.json`, and copies of `catalog.json` and `instructions.txt`, so that it can be re-judged in turn. `target.txt` is copied with ` (re-judged)` appended (once: a file that already ends so keeps one mark, and a `target.txt` left by an earlier re-judge is removed when the input has none), so the line that opens the report says what it reports on. Two reports of one run, judged by different checks, must not pass for the same thing.

**No network, by construction and by test.** The command makes no request. The package's offline setup already refuses any request but loopback, and a test runs the command under it.

**The environment is set around the run, and restored.** `EVAL_CATALOG` and `EVAL_INSTRUCTIONS` are set to the paths beside the file for the length of the command. The checks cache the snapshot by file stamp, so two run directories in one process stay apart.

## Choice of capability

`eval-run` owns the run directory, the snapshot, the instructions and the `EVAL_*` variables, and the re-judge reads and writes exactly those. `eval-report` owns the pass@k tables, and the re-judge changes none of them: its acceptance is that the report needs no change. Putting the command in `eval-report` would suggest the report grew a second input.

## Risks / Trade-offs

- [A rubric score belongs to the old verdicts' world, but a case whose checks flipped may now have a different judge story] → The rubrics grade the answer, which did not change. The report already shows them apart from the checks.
- [A case renamed or deleted since the run stops the command] → That is the right answer. The command names the ids. A baseline that old needs the commit that had its cases.
- [The recomputed `score` may differ from promptfoo's] → Pinned by the identity test against a saved file. The report does not read it.

## Open Questions

None that block. Assumed and open to change: the output sits in `rejudged/` beside the input with no flag, the repeat printed is the stored 0-based index, and `target.txt` gains the ` (re-judged)` suffix.
