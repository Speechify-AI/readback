# CLAUDE.md — Readback conventions

**Start here: read `RUNBOOK.md`** for what has been verified and what is
open. This file is the rules; the runbook is the state.

A VS Code extension that reads Claude Code's replies aloud in a Speechify
voice with word-level read-along. Open source (MIT), meant to drive
Speechify API adoption among developers. It lives at
<https://github.com/Speechify-AI/readback> and depends on nothing outside
this repo.

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
  raw payload of whichever event fired it (Stop, MessageDisplay or
  PreToolUse) to every listener on the machine, and exits 0 whatever happens. Which window
  speaks, which event it was, whether the text is long enough, what is
  read: all of that is the extension's call. Keep the hook dumb so it never
  needs updating in step with the extension.
- **Progress notes are read as they arrive; the finished reply is
  condensed.** MessageDisplay delivers each assistant message as its lines
  complete (`delta`, `final`, `message_id`). What follows the message says
  what it was, by `prompt_id`: PreToolUse means a note written before a
  tool call, read as it stands; Stop means the reply, condensed as before.
  `src/live.ts` holds each completed message until one arrives, with a long
  timer as the fallback only. Never decide by timing alone: Stop came 27 ms
  after the message headless and 1.5 s in an interactive session, and a
  1.5 s window read one reply twice. Stop's text is also checked against
  the last note read, so a reply already heard is not read again. At Stop,
  `last_assistant_message` wins over anything held. A turn is listed on its
  first note and grows; the webview is told what was appended and where,
  never handed a rewritten turn.
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
  our entries under `HOOK_EVENTS`, recognised by the fixed script path. If the file does not
  parse as JSON we say so and leave it alone.
- **The key is checked live before it is stored** and lives only in VS
  Code's SecretStorage. It is never written to settings, logs or the webview.
- **The hook script's path is fixed** (`~/.readback/hook.sh`) and rewritten
  on activation, so the settings entry never goes stale across extension
  updates.
- **Audio plays only in the webview** because VS Code has no other audio
  API. The view is resident (`retainContextWhenHidden`) and revealed once on
  the first turn so its audio element exists. The browser refuses to start
  sound until the window has had a click or keypress since the page was
  made (`NotAllowedError`; Electron `autoplayPolicy: "user-gesture-required"`
  with `allow="autoplay"` delegated to the webview), and a window reload
  makes a new page. The player shows a card until then and resumes the
  refused run on the first click. There is no way round the click; do not
  pretend there is.

## Structure

- `src/extension.ts` — activation, commands, the window-selection rule
- `src/listener.ts` — loopback HTTP listener and the endpoint file
- `src/claudeSettings.ts` — the hook script text and the settings merge
- `src/turns.ts` — text → message decision → Turn (plainify, paragraphs, lead-in, fullFrom)
- `src/live.ts` — the stream: MessageDisplay, PreToolUse and Stop payloads → progress notes and the finished reply
- `src/summary.ts` — the condensing run: brief, flags, finding `claude`
- `src/windows.ts` — the project rule, pure
- `src/playerView.ts` — the WebviewViewProvider and on-demand rendering
- `src/render.ts` — chunk, synthesize, stitch, fill gaps, cache
- `src/fileCache.ts` — renders on disk under global storage
- `src/speechify.ts`, `src/marks.ts`, `src/text.ts`, `src/audio.ts` —
  copied from Soundbites, Speechify's internal notebook (copies, not a
  dependency)
- `src/protocol.ts` — host/webview messages as discriminated unions
- `media/player.js`, `media/reader.js`, `media/player.css` — the webview
- `media/codicons/` — copied from `@vscode/codicons` by the build, not committed

## Commands

- `npm run typecheck` / `npm test` / `npm run build`
- `npm run package` — runs all three then `vsce package`
- `code --install-extension readback-<version>.vsix` to try it here
