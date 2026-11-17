# Design

## Context

The hook in `src/hooks.ts` runs before the first request and writes `target.txt`, `instructions.txt` and `catalog.json` beside the results. The reporter reads `target.txt` from the folder of the results file and prints it as its first line (`src/report/cli.ts`). The package holds the cases, the rubrics, the config and the sources of the checks, the oracle, the judge, the provider and the hook, and none of them is versioned. The package number is `0.0.0`.

## Goals / Non-Goals

**Goals:**
- A name for the eval of a run that does not depend on the commit of the CLI.
- The same name for the same eval, on any machine, in any order of files.
- A way to name an old eval from a checkout of it.

**Non-Goals:**
- A human version number, a changelog of the evals or a registry of fingerprints. A label such as a git tag can sit on top of the fingerprint later.
- Fingerprinting promptfoo or the CLI under test. The first is a dependency of the repository, and the second is already in `target.txt`.
- Saying whether two evals are compatible. Equal fingerprints say yes. Different ones say only that they differ.

## Decisions

**A content hash, not the commit and not a version number.** The commit changes with every edit to the CLI, the docs and the tests, so two runs of one eval look different. A version number needs someone to bump it, and a forgotten bump makes two evals look alike, which is worse than the reverse. A hash of the files cannot be forgotten.

**What is hashed: the eval's own files.** `promptfooconfig.yaml`, everything under `cases/` and `rubrics/`, and the sources under `src/` except `report/`, `calibrate/`, `run.ts` and `runner.ts`. The exclusion list is short and fails safe: a new source file is included until someone decides it is not part of the eval. Tests, docs, `package.json` and the lock file are out. Alternative: list the included directories. A new directory would then fall out of the fingerprint without anyone noticing.

**The input is the path and the content, in a fixed form.** Paths are relative to the package, with `/`, sorted by path. The content has `\r\n` replaced by `\n`. Each file adds its path, a zero byte, its content and a zero byte to a SHA-256 hash. The order of reading and the machine do not matter.

**Twelve characters of Crockford base 32, in upper case.** Sixty bits of the hash: a collision between two evals among a million needs about a thousand times more luck than the age of this repository allows. The alphabet leaves out `I`, `L`, `O` and `U`, so a fingerprint copied by hand, or read from a screen, keeps its meaning. Alternative: base 62, ten characters for about the same strength. It is shorter by two characters, and it keeps `0` and `O`, `1`, `l` and `I`, which a reader mixes up. Readability decides for base 32.

**One file, `eval.txt`, and a line in the report.** The hook writes it next to `target.txt`. The reporter prints `eval: <fingerprint>` after the target line. A results folder from before has no file, and its report stays as it was. `target.txt` is left alone, because a requirement says it stays byte for byte as before when no model is named.

**A script, `fingerprint`.** It prints the value for a checkout, so the eval of an old commit can be named with a worktree of it, and so the published 1.1.0 report can cite the fingerprint of the eval that measured it.

**The snapshot stays out.** The catalog changes every week, and `catalog.json` already holds it with its time. Two runs of one eval on two days have one fingerprint and two snapshots, and the report says both. The cases name groups by query, not by slug, so a changing catalog changes who is acceptable and not what the eval asks.

## Risks / Trade-offs

- [A change to a helper that no run depends on changes the fingerprint] → The fingerprint says "different" when the eval may be the same. That errs on the safe side, and the exclusion list can grow with a test that names why.
- [A dependency, such as promptfoo, changes behavior and not the fingerprint] → Out of scope. `pnpm-lock.yaml` and the commit identify it. A later change can add the version of promptfoo.
- [Line ends differ between machines] → Content is normalized to `\n` before hashing, and a test covers it.
- [The hook reads about a hundred files for each run] → Milliseconds. The run then makes requests that take minutes.

## Migration Plan

None. A run from before has no `eval.txt`, and its report is unchanged. After the merge, a run of the 1.1.0 report's commit prints its fingerprint with the script, and the docs can cite it.
