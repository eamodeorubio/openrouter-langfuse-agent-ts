# Tasks

Pull request title: `fix: hang up the connection after a timeout, even after garbage collection`. Bump: patch. One product slice, `fix:`.

## 1. Slice: hang up after a timeout (`fix:`)

- [x] 1.1 Add `test/gc.ts`, a helper that collects garbage on demand without a command-line flag. Verify that it frees an object nothing holds, under vitest and in Stryker's dry run (`pnpm exec stryker run --dryRunOnly`, exit 0).
- [x] 1.2 Write the failing integration test beside the existing hang-up test in `ask.stream.test.ts`: the server sends `Hel`, a collection runs before the idle limit, the server stays silent. Assert the server sees the close within 1 s of the failure. Covers Connection released: Garbage collection in between. Verify it fails because the close arrives late, and that it fails every time, over 20 runs.
- [x] 1.3 Write the failing unit tests for `client.ts`: a request made inside `withSignal` reaches `fetch` with that signal, so aborting it ends the request; a request outside any context keeps the signal of the request; two concurrent contexts do not see each other's signals (property test over interleavings). Covers Connection released and Lookups keep their deadline.
- [x] 1.4 Tighten the existing integration tests for `Silent from the start` and `Error chunk, connection left open` (they already use a server that keeps the connection open) to the 1 s bound of the spec. Covers Connection released. They pass at once; they guard the paths the fix touches.
- [x] 1.5 Implement the fetcher and `withSignal` in `src/client.ts`; run `client.chat.send` inside `withSignal` in `src/chat.ts`. Verify 1.2 to 1.4 pass, and that the full suite does too.
- [x] 1.6 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm mutation` (a forced run on `client.ts` and `chat.ts`). Handle every survivor. Run `pnpm exec stryker run --dryRunOnly` 8 times under CPU load: it must not fail.
- [x] 1.7 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`. Fix every must-fix finding. `reviewer-docs` has no page to read: the change alters no documented behavior, and it reads the spec and design.
- [x] 1.8 Write the full report. Wait for approval, which also approves the commit. Commit `fix: hang up the connection after a timeout, even after garbage collection`.

## 2. Close

- [x] 2.1 Run `/opsx:verify` and fix what it finds.
- [x] 2.2 With the user's approval, commit `chore: archive hang-up-after-timeout`.
- [ ] 2.3 Ask the user before every push and before the pull request.
