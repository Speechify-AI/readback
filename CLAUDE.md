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
- **The hook decides nothing.** It is POSIX shell plus curl (PowerShell on
  Windows, same lines), forwards the raw payload of whichever event fired
  it (Stop, MessageDisplay or PreToolUse, from Claude Code or Codex) to
  every listener on the machine, and exits 0 whatever happens. Which window
  speaks, which event it was, whether the text is long enough, what is
  read: all of that is the extension's call. Keep the hook dumb so it never
  needs updating in step with the extension.
- **Progress notes are read as they arrive; the finished reply is
  condensed.** MessageDisplay delivers each assistant message as its lines
  complete (`delta`, `final`, `message_id`). What follows the message says
  what it was, by `prompt_id`: PreToolUse means a note written before a
  tool call, read as it stands; Stop means the reply, condensed as before
  (a short one is read as it stands, see the condensing rule).
  `src/live.ts` holds each completed message until one arrives, with a long
  timer as the fallback only. Never decide by timing alone: Stop came 27 ms
  after the message headless and 1.5 s in an interactive session, and a
  1.5 s window read one reply twice. Stop's text is also checked against
  the last note read, so a reply already heard is not read again. At Stop,
  `last_assistant_message` wins over anything held. Claude's harness-prompted
  list of what to fetch next, opening "Private list" or made of two or
  more "(1)"/"(A)" items that open the message or name the batch, is
  dropped, not read (`isPlanningNote`). A turn is listed on its
  first note and grows; the webview is told what was appended and where,
  never handed a rewritten turn.
- **A waiting permission prompt is said at once; the next prompt stops the
  reading.** `Notification` with `permission_prompt` (Claude Code sends it
  once the prompt has waited about six seconds) becomes a one-sentence
  turn naming the tool call from the session's last `PreToolUse`, pushed
  urgent: the player puts whatever was playing back at the front of the
  queue and plays the alert. It is marked heard, so a catch-up never briefs
  a prompt answered since. `UserPromptSubmit` stops playback and empties the
  queue in that project's windows; a reply whose condensing run finishes
  after the prompt is listed without playing. Both respect the project rule
  like everything else.
- **The lead-in is the project name and nothing else.** Every turn of a
  project shares one render, so the cue plays from the cache within
  milliseconds; the time is shown in the turn's header, never spoken. A
  lead with the time in it was a fresh 1.3 to 1.8 s render before the first
  word of every turn.
- **Codex is a second source, Stop only.** Its Stop payload carries
  `last_assistant_message`, `session_id` and `cwd` like Claude's, no
  `prompt_id` and no MessageDisplay, so `LiveTurns` sees a keyless Stop
  and reads the reply; no notes. The entry goes in `~/.codex/hooks.json`
  (same `hooks` shape) through the same merge code with `CODEX_TARGET`.
  Codex runs a new hook only after the person trusts it in `/hooks`; the
  install message says so and nothing we write can skip that.
- **On Windows the Claude entry is exec form** (`command: powershell.exe`,
  the script path one element of `args`), so no shell tokenises it and no
  file association is consulted. Codex has no exec form and gets a
  `commandWindows` string. A Windows path never contains a double quote.
- **A turn is heard when it started playing while the window was focused.**
  The page reports every run start; the host keeps the set and applies the
  focus rule (`vscode.window.state.focused`). A catch-up covers the unheard
  turns, marks them heard, and is itself heard on arrival. Text goes to
  the same `condense` with `CATCH_UP_BRIEF`; without `claude` the covered
  turns' own spoken paragraphs are read in order.
- **Every window hears every turn; a window shows only its own project's.**
  A turn is this window's when the cwd is inside a workspace folder or
  contains one (`src/windows.ts`). No focused-window fallback: a panel full
  of another project's replies is worse than silence.
- **Condensing runs on the person's own Claude subscription, never on a key
  we hold.** `claude -p --model sonnet` with `--setting-sources ""` (no hooks
  load into that run) and `READBACK_HOOK=1` in its environment (the hook
  script exits at the top when it sees it). Both guards stay; either alone
  would do, both means a hook installed some other way still cannot loop. A
  failed run falls back to the full reply, never to silence. The brief and
  the reply both go on stdin, the reply fenced in `agent_output` tags and
  named as material (`condensePrompt`). Bare, Haiku sometimes answered the
  brief instead of condensing. The answer must come back inside `spoken`
  tags (`spokenFrom`); a run without them counts as failed. A reply under
  `CONDENSE_MIN_CHARS` once flattened is not condensed at all.
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

## Claude Code mod

The same product as a Claude Code plugin (`.claude-plugin/`, `hooks/`,
`mod/`), one repo and one version with the extension (`plugin.json` and
`package.json` must agree; a test holds them). It reuses the pure files
and shares none of the extension's host code.

- **On demand only.** Nothing plays or bills until the person presses play.
  Turning on runs `GET /v1/voices` and nothing else. Condensing runs at
  turn end on their Claude subscription, as in the extension.
- **One speaker across sessions.** A claim record under `$.store`'s `floor`
  key (`mod/floor.ts`), refreshed every second and free after 3 s without a
  heartbeat, so a crashed session never holds the floor. Pressing play
  takes it; losing it pauses without releasing anything. A session waiting
  on condensing holds the floor with nothing sounding, and another
  session's play cancels that wait.
- **The key lives only in the sensitive `userConfig` field
  `speechify_api_key`.** Never in `$.store`, a file, a log, a toast or the
  band. The install dialog cannot be hooked, so the key is checked live when
  the person turns Readback on, and a 401 or 403 on a later render turns it
  off with a notice pointing at `/plugin`.
- **1, 2 and 3 are always armed**, by the person's choice (2026-10-29). A
  bare digit in an empty prompt goes to the band, so a message cannot
  start with 1 or 3 typed first; accepted.
- **What is shown is what is spoken, in the band too.** The band draws only
  text from the rendered paragraph; only whitespace may be dropped.
- **Band layout is fixed.** A blank top row; then one controls row (Readback,
  Play/Pause/Resume, Stop only while loaded, Full reply, a dim meta);
  then the current sentence with every word dim but the spoken one. While
  condensing or rendering, a spinner row in Claude's orange says which, in
  place of the sentence. No progress bar, by the person's decision.
- **`READBACK_HOOK` guard.** The condensing run sets it, and a session that
  sees it (or is not interactive) turns every hook off. Same reason as the
  extension's hook script.
- **No Node in the mod.** Everything goes through `$`, spelled
  `$.noun.verb(...)` at the call site (a bare `$.http.fetch` reference is
  rejected by `claude plugin validate`). The `*Shared.ts` files and the
  other files the mod imports from `src/` must stay free of `node:*` and
  `package.json`; `src/shared.test.ts` enforces it.
- **A `command.run` hook answers and never calls `next`**: the validator
  lists one that does as a gating hook without a catch.
- **No `claude plugin test`.** With the repo root as the plugin root it
  runs every `*.test.ts` in the repo and the vitest suites fail there; it
  also raises no `session.start` and has no `$.fs`. Logic lives in `mod/`
  under vitest with fakes; `hooks/readback.ts` stays thin wiring, checked by
  `claude plugin validate`, the type-checks and the manual check in
  RUNBOOK.md.

## Structure

- `src/extension.ts` — activation, commands, the window-selection rule
- `src/listener.ts` — loopback HTTP listener and the endpoint file
- `src/claudeSettings.ts` — the hook scripts (sh, PowerShell), the entries per target (Claude, Codex) and the settings merge
- `src/turns.ts` — text → message decision → Turn (plainify, paragraphs, lead-in, fullFrom); the catch-up turn
- `src/live.ts` — the stream: MessageDisplay, PreToolUse and Stop payloads → progress notes and the finished reply
- `src/summary.ts` — the condensing run: the two briefs, flags, finding and spawning `claude` (`.exe` or npm `.cmd` shim on Windows)
- `src/windows.ts` — the project rule, pure
- `src/claudeLanguage.ts` — Claude Code's `language` setting → the default voice and the picker hint
- `src/playerView.ts` — the WebviewViewProvider, on-demand rendering, the voice catalogue and samples
- `src/render.ts` — chunk, synthesize, stitch, fill gaps, cache
- `src/fileCache.ts` — renders on disk under global storage
- `src/speechify.ts`, `src/marks.ts`, `src/text.ts`, `src/audio.ts` —
  copied from Soundbites, Speechify's internal notebook (copies, not a
  dependency)
- `src/protocol.ts` — host/webview messages as discriminated unions
- `src/webview/player.ts` — the page: DOM, audio element, panels, voice picker; applies what `Playlist` decides
- `src/webview/playlist.ts` — what plays next: queue, runs, `fullFrom`, urgent turns, autoplay-off counting, sentence steps; pure and tested
- `src/webview/reader.ts` — marks → sentence and word spans, the highlight (copied from Soundbites)
- `media/player.js` — the bundled page script, built from `src/webview/` by esbuild, not committed
- `media/player.css` — the webview's stylesheet
- `media/codicons/` — copied from `@vscode/codicons` by the build, not committed
- `.claude-plugin/plugin.json`, `marketplace.json` — the plugin manifest (with the sensitive key field) and the marketplace entry pinned to the release tag
- `hooks/readback.ts` — the mod's wiring: session, turn, command, band; decides nothing itself
- `mod/app.ts` — the wiring's decisions as pure helpers (command text, key check text, reply to turn, voice choice)
- `mod/player.ts`, `mod/floor.ts`, `mod/band.ts` — the player state machine, the cross-session speaker claim, the band drawing
- `mod/condense.ts`, `mod/speechify.ts`, `mod/cache.ts`, `mod/sentence.ts`, `mod/bytes.ts` — condensing run, API calls over `$.http`, render cache over `$.fs`, sentence steps, base64
- `src/*Shared.ts` — the Node-free halves of the extension's modules, imported by both

## Commands

- `npm run typecheck` (three configs: `tsconfig.json` for the host, `tsconfig.webview.json` with the DOM lib for `src/webview/`, `tsconfig.mod.json` for `mod/` and `hooks/`) / `npm test` / `npm run build`
- `npm test` is vitest, then `claude plugin validate .` when `claude` is on PATH (skipped otherwise); the validator is the only check of `hooks/readback.ts` against Claude Code's declarations
- `npm run package` — runs all three then `vsce package`
- `code --install-extension readback-<version>.vsix` to try it here
