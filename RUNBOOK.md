# RUNBOOK — Readback

Live state and what has been verified. Conventions live in `CLAUDE.md`.

## Status (2026-09-10)

**Built, unit-tested, live-tested against the Speechify API, packaged.**
Not yet exercised end to end with a real Claude Code turn: that needs a
human to run one after installing the hook.

| Thing | Value |
| --- | --- |
| Repo | <https://github.com/Speechify-AI/readback> (moved out of the internal monorepo 2026-09-10) |
| License | MIT |
| Marketplace publisher | `speechify`, created 2026-09-10 under shaun.trennery@gmail.com (Microsoft account); <https://marketplace.visualstudio.com/manage/publishers/speechify>. Domain `speechify.com` saved but not verified; no second member yet. |
| Model / default voice | `simba-3.2` / `harper_32` |
| Hook script | `~/.readback/hook.sh`, written on activation |
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

## Open

- **Does the Stop hook fire from the Claude Code panel in VS Code?** Docs
  say hooks fire everywhere; two GitHub issues say Stop does not in the
  panel. Test on the installed extension version. If it does not, the
  fallback is watching the session transcripts under `~/.claude/projects/`.
- **Speech marks on off-roster voices.** Since 2026-09-08 clones and
  non-`*_32` voices on simba-3.2 run on the zero-shot training, whose
  timestamped output fails at the last word (known to Speechify, being fixed). Read-along is
  reliable on the eight roster voices only until that is fixed.
- **Windows** needs a PowerShell hook.
- **Marketplace publisher** exists but is owned by one personal account.
  Add a Speechify co-owner under Members, and verify `speechify.com` (DNS
  TXT record) so the listing gets the verified badge. 0.2.4 was uploaded
  by hand through the manage page on 2026-09-10 (listing:
  <https://marketplace.visualstudio.com/items?itemName=speechify.readback>).
  No access token exists yet, so `vsce publish` and CI cannot release;
  nothing is on Open VSX.
- **A GIF for the README** once a real turn has been played.

## Trying it

```sh
npm run package
code --install-extension readback-0.2.4.vsix
```

If `code` on PATH is Cursor's shim, the VS Code binary is
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
Version history: 0.1.0 had a stroke-only activity bar icon that did not show; 0.1.1 filled paths, status bar entry, first-run key prompt; 0.1.3 the SpeechifyAI mark; 0.2.0 condensed turns, project-aware windows, codicon controls; 0.2.1 autoplay toggle; 0.2.2 fixed the first turn after a reload never autoplaying (posted before the page had loaded), and the player now logs need/render/play events to the Readback output channel; 0.2.3 the voice picker saves per project (workspace settings); 0.2.4 speed too.

Reload VS Code, open the Readback view in the activity bar, set the key,
install the hook, then run a Claude Code turn in the integrated terminal.
The Output panel's "Readback" channel logs every payload and decision.
