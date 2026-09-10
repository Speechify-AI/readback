# CLAUDE.md — Readback conventions

**Start here: read `RUNBOOK.md`** for what has been verified and what is
open. This file is the rules; the runbook is the state.

A VS Code extension that reads Claude Code's replies aloud in a Speechify
voice with word-level read-along. Open source (MIT), meant to drive
Speechify API adoption among developers. It lives under `tools/` while it is
built and moves to its own public repo when it is ready; nothing here may
depend on the rest of this monorepo.

## Invariants — never weaken

- **What is shown is what is spoken.** Markdown is flattened by `plainify`
  before anything is sent or displayed, so the speech marks' character
  offsets index the same string the player paints. Rendering markdown in
  the webview would break the highlight.
- **Highlighting is anchored on character offsets, never token positions,
  and gaps are absorbed forward.** Copied whole from Soundbites, evidence and
  all: `src/marks.ts` and its tests carry the measured API behaviour.
- **`/v1/audio/speech`, not `/v1/audio/stream`.** Only speech returns
  `speech_marks`. Its 2,000-character cap makes the paragraph the unit of
  rendering; longer paragraphs are chunked and the marks rebased by audio
  duration, never by the marks' own end.
- **Text is the truth, audio is a cache over it.** A render is keyed by
  `sha256(text)`, voice and model. Replaying never bills; switching voice
  re-renders rather than serving the wrong narrator.
- **Nothing renders ahead of the player.** The webview pulls a paragraph
  when the playhead is about to need it plus a two-paragraph look-ahead. A
  turn stopped after one sentence costs one sentence.
- **The hook decides nothing.** It is POSIX shell plus curl, forwards the
  raw Stop payload to every listener on the machine, and exits 0 whatever
  happens. Which window speaks, whether the reply is long enough, what is
  read: all of that is the extension's call. Keep the hook dumb so it never
  needs updating in step with the extension.
- **Every window hears every turn; a window shows only its own project's.**
  A turn is this window's when the cwd is inside a workspace folder or
  contains one (`src/windows.ts`). No focused-window fallback: a panel full
  of another project's replies is worse than silence.
- **Condensing runs on the person's own Claude subscription, never on a key
  we hold.** `claude -p --model haiku` with `--setting-sources ""` (no hooks
  load into that run) and `READBACK_HOOK=1` in its environment (the hook
  script exits at the top when it sees it). Both guards stay; either alone
  would do, both means a hook installed some other way still cannot loop. A
  failed run falls back to the full reply, never to silence.
- **A condensed turn carries the full reply too**, after `fullFrom` in the
  same paragraph list. Autoplay stops there; the full reply is one click
  away and costs nothing until played.
- **Settings merge, never overwrite.** `withHook`/`withoutHook` touch only
  our Stop entry, recognised by the fixed script path. If the file does not
  parse as JSON we say so and leave it alone.
- **The key is checked live before it is stored** and lives only in VS
  Code's SecretStorage. It is never written to settings, logs or the webview.
- **The hook script's path is fixed** (`~/.readback/hook.sh`) and rewritten
  on activation, so the settings entry never goes stale across extension
  updates.
- **Audio plays only in the webview** because VS Code has no other audio
  API. The view is resident (`retainContextWhenHidden`) and revealed once on
  the first turn so its audio element exists.

## Structure

- `src/extension.ts` — activation, commands, the window-selection rule
- `src/listener.ts` — loopback HTTP listener and the endpoint file
- `src/claudeSettings.ts` — the hook script text and the settings merge
- `src/turns.ts` — Stop payload → message → Turn (plainify, paragraphs, lead-in, fullFrom)
- `src/summary.ts` — the condensing run: brief, flags, finding `claude`
- `src/windows.ts` — the project rule, pure
- `src/playerView.ts` — the WebviewViewProvider and on-demand rendering
- `src/render.ts` — chunk, synthesize, stitch, fill gaps, cache
- `src/fileCache.ts` — renders on disk under global storage
- `src/speechify.ts`, `src/marks.ts`, `src/text.ts`, `src/audio.ts` —
  copied from `tools/soundbites` (repo rule: copy, never import)
- `src/protocol.ts` — host/webview messages as discriminated unions
- `media/player.js`, `media/reader.js`, `media/player.css` — the webview
- `media/codicons/` — copied from `@vscode/codicons` by the build, not committed

## Commands

- `npm run typecheck` / `npm test` / `npm run build`
- `npm run package` — runs all three then `vsce package`
- `code --install-extension readback-<version>.vsix` to try it here
