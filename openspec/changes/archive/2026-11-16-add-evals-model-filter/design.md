# Design

## Context

The matrix is a list of models in `defaultTest.vars.model`, and promptfoo runs each case once per value. There is one provider, `ask-openrouter-cli`, which reads `context.vars.model`. A `--filter-providers` flag has nothing to match, so the filter has to narrow the list.

The runner starts promptfoo and passes what the setup needs through environment variables: `EVAL_CLI_VERSION`, `EVAL_OUT`. The setup runs in the `beforeAll` hook of `src/hooks.ts`, which already reads the suite through `modelsOf` to build `EVAL_MODELS`, the list the placeholders avoid. The hook returns nothing today.

In promptfoo 0.125.1, `runExtensionHook` keeps `defaultTest` from a truthy return value of the hook, and the evaluator reads the returned suite from then on (`evaluator-BxCmvGtv.js:8459`). A hook that returns `{ suite }` with a narrowed `defaultTest` therefore changes the matrix. Whether the `vars` list expands after the hook is read from the code, not observed, and the integration test settles it.

## Goals / Non-Goals

**Goals:**
- One flag, one meaning: ask a subset of the config's models.
- A run without the flag behaves as it does today, to the byte.
- A bad id costs nothing: it stops before the first request.

**Non-Goals:**
- Models outside the config. The flag does not accept an id because the catalog lists it.
- Moving the models into `providers:`. That changes the report's grouping and the cases, and wants its own change.
- Filtering by anything but the id: no globs, no "free" or "paid" keywords.

## Decisions

**The hook narrows the list and returns the suite.** The runner only checks the shape of the flag and passes it as `EVAL_MODELS_FILTER`. The narrowing lives in `models.ts`, next to `modelsOf`, and says why an id is refused with a sentence, which the hook raises as a setup failure. The hook compares the ids with `modelsOf(suite)`, so the check holds also for a run started on the config directly, and the config stays the one place that names the models. The alternative, validating in the runner, would need to load the YAML a second time.

**Unknown ids end in the setup failure.** The hook already stops a bad setup with one sentence and exit code 3, and the runner passes the code on. The model check runs first in the setup, before the warm-up of a published version and before the catalog fetch, which is a request.

**Order and duplicates follow the config.** The result is the config's models that the list names, each once. The order of the flag has no effect, so two runs that name the same models write the same results. A repeated id is not an error: it asks nothing new.

**`EVAL_MODELS` takes the narrowed list.** The free-model pick is meant to avoid the models under test. A model that is left out is not under test, so it may be picked. That is what lets a run of the paid model alone use the free model as the free answer.

**The models go on the target line.** `target.txt` already feeds the first line of the report, and an A/A artifact is found by its target. The line gains `, models: <ids>` only for a narrowed run, so the file of an unnarrowed run does not change. The alternative, a second file, would leave the report unable to say what it covers.

**The workflow passes the flag only when the input is set.** An empty `model` input adds no argument. The value reaches the shell through `env:` like the other inputs. The runner owns the validation.

## Risks / Trade-offs

- [The matrix may expand before `beforeAll`, and then the narrowed list has no effect] → The first test is an integration test through promptfoo against the loopback fake provider. It must fail first, for that reason, and it asserts that no case of the left-out model starts.
- [The returned suite replaces fields the hook did not touch] → The hook returns the suite it received with only `defaultTest` replaced, and a test compares the other fields.
- [A model leaves the free tier or is renamed, and an A/A job that names it fails] → The refusal lists the config's models, so the fix is to edit the workflow input.
- [The `model` input is free text in the workflow] → The runner refuses anything but a config id, and the value never reaches a shell unquoted.
