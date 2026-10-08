# RUNBOOK — Readback

Live state and what has been verified. Conventions live in `CLAUDE.md`.

## Status (2026-10-08)

**0.7.0 packaged and installed here (VS Code, 2026-10-08), not yet
uploaded; 0.5.0 is on the VS Code Marketplace.** 0.7.0 adds permission alerts, stop
on the next prompt, the one-word lead-in and the webview in TypeScript,
all four seen working in the Readback log on 2026-10-08 at 15:43 to 15:47
(see Verified, 2026-10-08, later); what remains is by ear, see Open. The hook now registers five events, so after installing 0.7.0 the
"Install the hook" card shows again until it is pressed once. It carries
0.6.0, which was never uploaded either: non-English voices on simba-3.0 and the
default voice from Claude Code's `language`; see Verified, 2026-10-08. It
carries 0.5.1, which was never uploaded: the condense run that answered
the brief, condensing on Sonnet, short replies read as they stand
("condense ok" in 4 to 6 s in today's log). 0.5.0 added catch-up, Codex as a source and the
Windows hook; none of the three has had a live run yet, see Open. Built, unit-tested, live-tested against the Speechify API,
and exercised end to end with real Claude Code turns on 2026-09-10 (0.3.0,
Claude Code 2.1.267, the VS Code integrated terminal). Progress notes
arrived, rendered and were appended; the finished reply was condensed and
appended after them. What did not happen was sound: see the autoplay note
under Verified.

| Thing | Value |
| --- | --- |
| Repo | <https://github.com/Speechify-AI/readback> (moved out of the internal monorepo 2026-09-10) |
| License | MIT |
| Marketplace publisher | `speechify`, created 2026-09-10 under shaun.trennery@gmail.com (Microsoft account); <https://marketplace.visualstudio.com/manage/publishers/speechify>. Domain `speechify.com` saved but not verified; no second member yet. |
| Model / default voice | `simba-3.2` / `harper_32` |
| Hook script | `~/.readback/hook.sh` (`hook.ps1` on Windows), written on activation, registered under `Stop`, `MessageDisplay`, `PreToolUse`, `Notification` and `UserPromptSubmit` in `~/.claude/settings.json`; under `Stop` only in `~/.codex/hooks.json` when the Codex hook is installed |
| Endpoint files | `~/.readback/endpoints/<pid>` holding `port token` |
| Render cache | `<globalStorage>/speechify.readback/cache/<model>/<voice>/<sha256>.{mp3,json}` |
| API key | VS Code SecretStorage, key `readback.speechifyApiKey` |

## Verified on 2026-09-10

- 63 unit tests: marks (copied evidence), text, settings merge, turns,
  render stitching and cache, listener auth.
- Live render of one 129-character paragraph through `/v1/audio/speech`
  with `harper_32` on a live key: 3.7 s round trip, 10.6 s of audio, 26
  marks tiling the whole string after `fillGaps` (the "(a Thursday)" case
  included). `checkKey` on the same key listed 131 voices for simba-3.2 in
  under a second, which is the post-2026-09-08 catalogue, clones included.
- A condense run (`claude -p --model haiku`, the flags in `src/summary.ts`)
  on a 900-character reply: 9.0 s, two sentences that read well aloud, on
  Claude Code 2.1.267 at `~/.local/bin/claude`.
- The shell hook, run against a live listener with a stale endpoint file
  present and a space in the home path: payload delivered byte for byte,
  stale file removed. A post to a live listener takes about 15 ms; a
  refused port fails in 10 ms.
- **Hook events, measured on Claude Code 2.1.267 with `claude -p`** and a
  capture script registered for Stop, MessageDisplay, UserPromptSubmit,
  PreToolUse, Notification and StopFailure (prompt: two sentences, a Bash
  call, a six-paragraph reply):
  - `MessageDisplay` fires once per assistant message with `delta`,
    `final: true`, `index: 0`, `message_id`, `turn_id`, plus the common
    `session_id`, `prompt_id`, `cwd`, `transcript_path`. The docs page
    names the fields `message_delta`/`message_text`; the binary and the
    live payload say `delta`. In headless mode every message arrived as one
    flush; the binary's own schema text says "fired with each batch of
    newly completed lines", so interactive sessions may send several
    flushes per message, `index` counting up and `final` on the last.
    `src/live.ts` joins flushes by `message_id` either way.
  - `Stop` fired 27 ms after the last message's final flush, with the same
    `prompt_id`, `last_assistant_message` equal to that message's text, and
    `stop_hook_active`. No `stop_reason` and no `turn_id`. **In the
    interactive session it was about 1,520 ms** (Readback log, 17:18 on
    2026-09-10), which put it outside the 1,500 ms window 0.3.0 used and
    read that reply twice, once as a note and once condensed. Since 0.3.3
    PreToolUse is the signal that a message was a note (it followed one by
    about 400 ms headless), the timer is a 5 s fallback, and Stop's text is
    checked against the last note read. The log now prints the wait.
  - `UserPromptSubmit` carries the prompt in `prompt` (not `user_prompt`).
  - An `async: true` Stop hook did not run at all when the headless process
    exited straight after Stop; synchronous hooks did. Interactive sessions
    stay alive, so this should not bite there, but it is why the capture
    used sync hooks.
  - `MessageDisplay` is present in the 2.1.263, 2.1.266 and 2.1.267
    binaries on this machine and absent from the public changelog. Older
    versions were not checked.
- **Progress notes end to end** (Readback log, 17:01 on 2026-09-10): a
  turn "started with 1 progress paragraphs" 8 s after the page loaded, the
  lead and the note rendered, condense took 7.4 s, and the turn "grew by 5
  (condensed)". A second turn listed and queued behind it. The session had
  been started after the MessageDisplay entry was added.
- **Autoplay after a reload is refused by the browser, not by Readback.**
  Every log on this machine shows the same shape: the first `play()` after
  "player ready" fails with `NotAllowedError`; turns later in the same page
  play. VS Code's Electron window is created with `autoplayPolicy:
  "user-gesture-required"` and both webview frames carry `allow="autoplay"`
  (found in the installed build), so sound needs a click or keypress in the
  VS Code window since the page was made, and a window reload makes a new
  page. Shaun confirmed on 2026-09-10 that a click anywhere unlocked it.
  0.3.1 shows a "Click once to turn sound on" card until then (using
  `navigator.userActivation`, and the refusal itself as a fallback) and a
  click resumes the refused run and the queue behind it; 0.3.3 also hides
  the card once a play succeeds. The 0.2.2 "first turn after a reload" fix
  was a different cause (posting before the page had loaded).

## Verified on 2026-09-22

- **Hooks fire in the Claude Code panel.** The hooks documentation now
  says the same events fire wherever Claude Code runs: terminal, IDE
  extensions, the desktop app and cloud sessions. Not re-measured here.
- **`MessageDisplay` is documented** (<https://code.claude.com/docs/en/hooks>)
  with the fields `src/live.ts` reads: `turn_id`, `message_id`, `index`,
  `final`, `delta`, plus the common fields. The docs say it fires once per
  batch of completed lines in interactive sessions and once per message in
  `-p` mode, which is what the 2026-09-10 capture showed. The changelog
  from 2.1.267 to 2.1.278 changes nothing in the Stop or MessageDisplay
  payloads and adds no hook events. There is still no documented way for a
  hook to tell a headless run from an interactive one, so the
  `READBACK_HOOK` marker stays.
- **Speech marks reach the last word on off-roster stock voices.** The
  same 101-character sentence rendered through `/v1/audio/speech` on
  `harper_32`, `george` and `oliver` (simba-3.2) returned 19 marks each,
  the last one `Thursday).` ending at offset 101. The 2026-09-08 failure at
  the last word no longer shows on stock voices. Clones were not tested:
  the key used carries none.

- **Codex CLI hooks, from the docs and source** (codex 0.155.1,
  <https://developers.openai.com/codex/hooks>, `codex-rs/hooks`): file
  `~/.codex/hooks.json` with the same `{"hooks": {Event: [{hooks: [...]}]}}`
  shape, feature `features.hooks` on by default. Events include `Stop`,
  `PreToolUse`, `UserPromptSubmit`, `SessionStart`; nothing per message.
  Stop's stdin is `session_id`, `turn_id`, `cwd`, `transcript_path`,
  `hook_event_name`, `model`, `permission_mode`, `stop_hook_active`,
  `last_assistant_message` (nullable). Hooks run through the user's shell
  (`$SHELL -lc`; PowerShell or cmd on Windows, `commandWindows` overrides).
  Every new or changed hook must be trusted once in `/hooks`, recorded as a
  hash in config.toml; untrusted hooks are skipped. Not yet run live.
- **The catch-up brief on Haiku**: three sample replies from three
  projects, 13 s, three short paragraphs grouped by project, decisions
  called out. Not yet heard through the player.

## Verified on 2026-10-01

Claude Code 2.1.286 throughout. The reply used is the one from `customers`
at 10:29: two paragraphs, 300 characters, ending "Send me its `ws_` id and
the tier shape you want and I'll apply it in Atlas".

- **A condense run that answered the brief.** That reply came back
  condensed as "I understand. When condensing a finished reply for someone
  reading it aloud moments after, I'll deliver one to three short
  sentences", and the log called it "condense ok in 14992 ms". Re-run on
  Haiku with the brief as the prompt argument, 1 run in 12 did it again.
  With the brief and the reply both on stdin and the reply fenced in
  `agent_output` tags (`condensePrompt`), 0 in 24.
- **Sonnet instead of Haiku.** Same fenced prompt, five runs at a time.
  Haiku took 5.9 to 16.9 s, median about 7 s. Sonnet took 3.1 to 4.0 s. On
  a 2,234-character reply Sonnet kept "I couldn't test the create myself"
  in all 17 runs and Haiku dropped it in all 5. It uses more of the
  person's subscription allowance per reply than Haiku does; nobody has
  measured how much.
- **The `spoken` tags are the check on a run.** Sonnet, fenced: 28 runs in
  28 answered inside the tags (12 on the short reply, 12 on the long one,
  4 catch-ups). Haiku on the old bare layout with the tag instruction
  added: 5 runs in 36 went wrong ("I understand", "I don't see a reply to
  condense") and none of the 5 had the tags; all 31 good runs did. A run
  without them is logged as "condense failed" and the full reply is read.
- **Replies under 500 characters are not condensed**
  (`CONDENSE_MIN_CHARS`, measured on the flattened text). On Sonnet the
  300-character reply condensed to 253 to 292 characters and the
  2,234-character one to 386 to 456, so below 500 the run saves nothing.
  The log says "the reply is already short". Catch-up still
  condenses whatever it covers.
- **TypeScript 7.0.2** typechecks the tree with no config change. vitest
  5.0.3 and `@types/node` 22.20.4 are in, `npm audit` is clean, 110 tests
  pass.
- **`@vscode/vsce` 4.0.0** packages a vsix with the same 13 files as
  3.9.2. It needs Node 22, so `engines.node` is now `>=22`. Published on
  2026-09-29; no publish has gone through it yet.
- None of this has been heard through the player. The checks were unit
  tests and direct runs of `condense`.

## Verified on 2026-10-08

- **Non-English voices.** Speechify's language-support guide and the
  `/v1/audio/speech` reference (read 2026-10-08): `simba-3.2` is English
  only and answers 400 for a non-English voice; `simba-3.0` speaks en,
  de-DE, es-ES, es-MX, fr-FR, it-IT, pt-BR; `language` is optional,
  `es-ES` form, and when omitted the voice's locale is used. So until now
  the picker listed English voices only. The model now follows the voice
  (`modelFor`): English or no locale on `readback.model`, anything else on
  `simba-3.0`, and `language` is sent from the voice's locale
  (`languageFor`). The lead-in dropped "in" ("14:32, readback.") so it
  reads in any language; the catch-up lead is still English.
- **Claude Code's `language` setting** ("Preferred language for Claude
  responses and voice dictation", free text such as `"spanish"`, in the
  2.1.294 binary's settings schema) is read from `~/.claude/settings.json`
  and each folder's `.claude/settings.json` and `settings.local.json`,
  later wins. Mapped to the six simba-3.0 languages (`languageCode`). While
  `readback.voice` is unset in every scope, a non-English value picks the
  first stock voice in that language; nothing is written. The picker puts
  that language first and says so when the current voice speaks another.
  The hint was seen live with `"language": "spanish"` and `geffen_32`.
- **Condensing keeps the reply's language** (Sonnet, the flags in
  `src/summary.ts`, 3 runs per brief). A Spanish reply through `BRIEF`:
  Spanish 3 of 3 with or without the new language clause. Two Spanish
  replies through `CATCH_UP_BRIEF`, whose headers are English: English 3
  of 3 without the clause, Spanish 3 of 3 with it.

## Verified on 2026-10-08, later

- **Hook payloads for the two new events**, from the 2.1.294 binary's
  schemas and the hooks page (<https://code.claude.com/docs/en/hooks>,
  read 2026-10-08). `Notification`: `message`, optional `title`,
  `notification_type`, plus the common fields (`session_id`, `cwd`,
  `prompt_id`). `permission_prompt` fires when "Claude needs you to approve
  a tool use or a sandboxed command's network request, and the prompt has
  waited about six seconds"; its message is "Claude needs your permission
  to use <tool>". Other types (`idle_prompt`, `auth_success`, the
  elicitation and quota ones) are ignored. `UserPromptSubmit`: `prompt`,
  optional `source` and `session_title`, plus the common fields.
  `PreToolUse` carries `tool_name` and `tool_input` and runs before the
  permission flow, so the session's last one is the call the prompt is
  about. None of this has fired through the player yet.
- **Lead-in render times**, from the Readback logs on this machine: a lead
  ("14:32, readback.") rendered live in 1,294 to 1,781 ms across 11 turns
  and in 8 ms the one time it was cached. The first content paragraph
  rendered in 1,840 to 5,573 ms alongside it. The lead is now the project
  name alone, so it is cached after the first turn of a project.
- **0.7.0 through the player** (Readback log, window 4, 15:43 to 15:47 on
  2026-10-08; Claude Code 2.1.294). The hook card came back after the
  install and "Install the hook" wrote the five events to
  `~/.claude/settings.json` at 15:43:09. Then, live from this session's
  own hooks: the lead "readback." rendered in 1,159 ms on the first turn
  and 6 ms on the next (cached); `UserPromptSubmit` logged "a new prompt
  in readback; stopped reading" at 15:43:12 and 15:44:06, the second while
  an 18.9 s paragraph was playing. Then, from payloads posted straight to
  the listener in the documented shapes: a short reply listed and playing
  (lead 7 ms, body 2,911 ms), PreToolUse `Bash npm install` followed by a
  `permission_prompt` Notification gave "alert: Claude is waiting for your
  permission to run npm install, in readback.", "listed, autoplay yes,
  urgent", rendered in 1,823 ms (4.5 s of audio); a 700-character Stop
  followed 1.5 s later by UserPromptSubmit gave "stopped reading",
  "condense ok in 3882 ms", "the person has moved on since this reply;
  listing it without playing", "listed, autoplay no".
- 138 unit tests, 11 of them on `src/webview/playlist.ts` (queue order,
  runs stopping at `fullFrom`, growth, urgent turns, autoplay off, stop)
  and 2 on sentence stepping. The page script is bundled from
  `src/webview/` by esbuild into `media/player.js`, which is no longer
  committed; `npm run typecheck` checks it against the DOM lib through
  `tsconfig.webview.json`.

## Open

- **0.7.0 by ear, partly.** Shaun heard the 15:46 alert cut in and the
  reply carry on and called it good (2026-10-08). Not yet looked at: the
  time in the turn header next to the one-word lead, and the transport,
  full-reply section, voice picker and samples, which were ported with the
  page and have had one clear-list press, nothing more.
- **A real `permission_prompt` Notification.** The alert was driven by a
  payload posted to the listener in the documented shape; no interactive
  session has left a prompt waiting six seconds with the hook installed.
  One such turn settles whether the live `message` and `tool_input` match.
- **Non-English on a live key: verified 2026-10-08.** The catalogue grew
  from 131 to 1,059 voices once non-English ones were listed. `aitana`
  rendered on `simba-3.0 (es-MX)`, English and Spanish text, highlight
  followed to the end by eye. `geffen_32` rendered on `simba-3.2 (en-US)`,
  so the language field is accepted there. Not yet measured: the last
  mark's end against the text's length on `simba-3.0`.
- **The default voice from Claude's `language`** has not run live: unset
  `readback.voice` in every scope, set `"language": "spanish"`, play a
  turn, expect `on simba-3.0 (es-…)` in the log.
- The log line "N voices for simba-3.2" now counts voices on both models.

- **Speech marks on cloned voices.** Stock off-roster voices are fine
  again (see Verified, 2026-09-22). Render one sentence on a personal
  clone and check the last mark ends at the text's length before telling
  anyone read-along works on clones.
- **Windows is written, not tried.** `hook.ps1` (Windows PowerShell 5.1
  syntax, `Invoke-RestMethod`), the exec-form entry, `claude.exe` and the
  npm `.cmd` shim through cmd.exe. Known Windows hook issues in the Claude
  Code tracker as of 2026-09-22: #36156 (stdin arrives empty), #88896
  (PreToolUse never fires, closed not planned), #29007 (the VS Code
  extension mangles backslashes in hook commands). Any of them would show
  as silence; the Readback log will say whether a payload arrived.
- **Codex end to end.** Install the hook, trust it in `/hooks`, run a turn,
  confirm a Stop payload arrives and is read. Whether the desktop app
  surfaces the trust review is unconfirmed.
- **Catch-up end to end.** Let two replies play with the window
  unfocused, come back, press the history button; expect one briefing turn
  and the two marked heard (a second press says nothing to catch up on).
- **0.5.1 through the player.** Install it, reload, run a turn with a long
  reply and one with a short reply. Expect "condense ok" in about 4 s on
  the first and "the reply is already short" on the second. A "condense
  failed" line now also means a run that answered outside the `spoken`
  tags; count them.
- **Marketplace publisher** exists but is owned by one personal account.
  Add a Speechify co-owner under Members, and verify `speechify.com` (DNS
  TXT record) so the listing gets the verified badge. 0.2.4 was uploaded
  by hand through the manage page on 2026-09-10 (listing:
  <https://marketplace.visualstudio.com/items?itemName=speechify.readback>);
  0.3.3, 0.4.0 and 0.4.1 the same way on 2026-09-10 and 2026-09-11, and
  0.5.0 on 2026-09-22.
  No access token exists yet, so `vsce publish` and CI cannot release;
  nothing is on Open VSX (checked 2026-09-22), so Cursor, Windsurf and
  VSCodium users cannot install it from their marketplaces.
- **A GIF for the README** once a real turn has been played.
- **Voice samples on a live key: verified 2026-09-11.** Shaun opened the
  picker on 0.4.0 and samples played. The picker plays the catalogue's
  `preview_audio` when a voice has one and otherwise synthesizes
  `SAMPLE_LINE` (`src/playerView.ts`) in that voice through the render
  cache, so it bills once per voice. Not yet counted: how many voices carry
  a preview versus a synthesized line (the Readback log prints which).
- **Progress notes with sound.** Heard end to end on 2026-09-10 after the
  click. Still to confirm on 0.3.3: a reply is never read twice (look for
  "already read as a note" and the "Stop came N ms" lines), and notes are
  released by PreToolUse rather than the timer ("released by tool").
- **What older Claude Code does with an unknown `MessageDisplay` key** in
  `hooks`. Ignored is the expectation; a version before 2.1.263 should be
  tried once.

## Trying it

```sh
npm run package
code --install-extension readback-0.7.0.vsix
```

If `code` on PATH is Cursor's shim, the VS Code binary is
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
Version history: 0.1.0 had a stroke-only activity bar icon that did not show; 0.1.1 filled paths, status bar entry, first-run key prompt; 0.1.3 the SpeechifyAI mark; 0.2.0 condensed turns, project-aware windows, codicon controls; 0.2.1 autoplay toggle; 0.2.2 fixed the first turn after a reload never autoplaying (posted before the page had loaded), and the player now logs need/render/play events to the Readback output channel; 0.2.3 the voice picker saves per project (workspace settings); 0.2.4 speed too; 0.3.0 progress notes between tool calls via the MessageDisplay hook, turns that grow in the player, `readback.progress` setting; 0.3.1 the "click once to turn sound on" card; 0.3.2 logs the card, the first click and the first successful play so the autoplay question can be settled from the log; 0.3.3 PreToolUse tells a note from the reply, Stop's text is checked against the last note read, timer fallback 5 s; 0.4.0 voice picker in the panel (search, filters, grouped by language, a sample per voice), a clear button and command, new empty-state copy, the bar reduced to transport plus a gear and clear; voice, speed and autoplay live in a settings panel behind the gear. Catalogue tags arrive as `Category:Value` (`Use-Case:Audiobook-Long-Form`, `Age:Middle-Aged`); the picker shows the value only; 0.4.1 the settings panel gains an API key row (status, change, link to the keys page) and an "All Readback settings" link into the filtered Settings editor. "Featured" is the roster, defined in `isFeatured` as the `*_32` ids on simba-3.2: the API has no flag for it (`curated_voices` on the model list is deprecated and always false). Until 2026-09-22 they were also the only voices whose speech marks reached the last word; stock voices are fine again since then; 0.5.0 catch-up (history button and command, focus-based heard rule, `CATCH_UP_BRIEF`), Codex CLI as a Stop-only second source (settings panel row, two commands), Windows hook (PowerShell, exec form), the Featured hint reads "Trained for this model"; 0.5.1 the condensing run reads the reply fenced and must answer inside `spoken` tags (a 0.5.0 run answered the brief instead of condensing), condensing moved from Haiku to Sonnet, replies under 500 characters are read as they stand, TypeScript 7 and vsce 4. 0.6.0 non-English voices: the model follows the voice (English on `readback.model`, the rest on `simba-3.0`) and `language` is sent from the voice's locale; Claude Code's `language` setting picks the default voice and the picker says when they disagree; condensing answers in the reply's language; the lead-in drops "in". 0.7.0 permission alerts (`Notification` hook, `readback.alerts`), stop on `UserPromptSubmit`, the lead-in is the project name alone with the time shown in the header, the webview moved to `src/webview/` in TypeScript with the play order in a tested `Playlist`.

Reload VS Code, open the Readback view in the activity bar, set the key,
install the hook, then run a Claude Code turn in the integrated terminal.
The Output panel's "Readback" channel logs every payload and decision.
