# RUNBOOK — Readback

Live state and what has been verified. Conventions live in `CLAUDE.md`.

## Status (2026-09-22)

**0.5.0 packaged and installed locally; 0.4.1 is on the VS Code
Marketplace** (four versions listed, 8 installs on 2026-09-22). 0.5.0 adds
catch-up, Codex as a source and the Windows hook; none of the three has had
a live run yet, see Open. Built, unit-tested, live-tested against the Speechify API,
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
| Hook script | `~/.readback/hook.sh` (`hook.ps1` on Windows), written on activation, registered under `Stop`, `MessageDisplay` and `PreToolUse` in `~/.claude/settings.json`; under `Stop` only in `~/.codex/hooks.json` when the Codex hook is installed |
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

## Open

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
- **Marketplace publisher** exists but is owned by one personal account.
  Add a Speechify co-owner under Members, and verify `speechify.com` (DNS
  TXT record) so the listing gets the verified badge. 0.2.4 was uploaded
  by hand through the manage page on 2026-09-10 (listing:
  <https://marketplace.visualstudio.com/items?itemName=speechify.readback>);
  0.3.3, 0.4.0 and 0.4.1 the same way on 2026-09-10 and 2026-09-11.
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
code --install-extension readback-0.5.0.vsix
```

If `code` on PATH is Cursor's shim, the VS Code binary is
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
Version history: 0.1.0 had a stroke-only activity bar icon that did not show; 0.1.1 filled paths, status bar entry, first-run key prompt; 0.1.3 the SpeechifyAI mark; 0.2.0 condensed turns, project-aware windows, codicon controls; 0.2.1 autoplay toggle; 0.2.2 fixed the first turn after a reload never autoplaying (posted before the page had loaded), and the player now logs need/render/play events to the Readback output channel; 0.2.3 the voice picker saves per project (workspace settings); 0.2.4 speed too; 0.3.0 progress notes between tool calls via the MessageDisplay hook, turns that grow in the player, `readback.progress` setting; 0.3.1 the "click once to turn sound on" card; 0.3.2 logs the card, the first click and the first successful play so the autoplay question can be settled from the log; 0.3.3 PreToolUse tells a note from the reply, Stop's text is checked against the last note read, timer fallback 5 s; 0.4.0 voice picker in the panel (search, filters, grouped by language, a sample per voice), a clear button and command, new empty-state copy, the bar reduced to transport plus a gear and clear; voice, speed and autoplay live in a settings panel behind the gear. Catalogue tags arrive as `Category:Value` (`Use-Case:Audiobook-Long-Form`, `Age:Middle-Aged`); the picker shows the value only; 0.4.1 the settings panel gains an API key row (status, change, link to the keys page) and an "All Readback settings" link into the filtered Settings editor. "Featured" is the roster, defined in `isFeatured` as the `*_32` ids on simba-3.2: the API has no flag for it (`curated_voices` on the model list is deprecated and always false). Until 2026-09-22 they were also the only voices whose speech marks reached the last word; stock voices are fine again since then; 0.5.0 catch-up (history button and command, focus-based heard rule, `CATCH_UP_BRIEF`), Codex CLI as a Stop-only second source (settings panel row, two commands), Windows hook (PowerShell, exec form), the Featured hint reads "Trained for this model".

Reload VS Code, open the Readback view in the activity bar, set the key,
install the hook, then run a Claude Code turn in the integrated terminal.
The Output panel's "Readback" channel logs every payload and decision.
