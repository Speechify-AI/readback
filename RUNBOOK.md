# RUNBOOK — Readback

Live state and what has been verified. Conventions live in `CLAUDE.md`.

## Status (2026-09-10)

**Built, unit-tested, live-tested against the Speechify API, packaged.**
Not yet exercised end to end with a real Claude Code turn: that needs a
human to run one after installing the hook.

| Thing | Value |
| --- | --- |
| Folder | `tools/readback/` (moves to its own public repo when ready) |
| License | MIT |
| Publisher id in the manifest | `speechify` (placeholder until the Marketplace publisher exists) |
| Model / default voice | `simba-3.2` / `harper_32` |
| Hook script | `~/.readback/hook.sh`, written on activation |
| Endpoint files | `~/.readback/endpoints/<pid>` holding `port token` |
| Render cache | `<globalStorage>/speechify.readback/cache/<model>/<voice>/<sha256>.{mp3,json}` |
| API key | VS Code SecretStorage, key `readback.speechifyApiKey` |

## Verified on 2026-09-10

- 63 unit tests: marks (copied evidence), text, settings merge, turns,
  render stitching and cache, listener auth.
- Live render of one 129-character paragraph through `/v1/audio/speech`
  with `harper_32` on Shaun's key: 3.7 s round trip, 10.6 s of audio, 26
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
  timestamped output fails at the last word (AIS-7105). Read-along is
  reliable on the eight roster voices only until that is fixed.
- **Windows** needs a PowerShell hook.
- **Marketplace publisher** must be created under the Speechify account
  before publishing; the manifest's `publisher` field then has to match.
- **A GIF for the README** once a real turn has been played.

## Trying it

```sh
cd tools/readback
npm run package
code --install-extension readback-0.2.4.vsix
```

On this Mac `code` on PATH is Cursor's shim; the VS Code binary is
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
Version 0.2.4 is installed in both as of 2026-09-10. History: 0.1.0 had a stroke-only activity bar icon that did not show; 0.1.1 filled paths, status bar entry, first-run key prompt; 0.1.3 the SpeechifyAI mark; 0.2.0 condensed turns, project-aware windows, codicon controls; 0.2.1 autoplay toggle; 0.2.2 fixed the first turn after a reload never autoplaying (posted before the page had loaded), and the player now logs need/render/play events to the Readback output channel; 0.2.3 the voice picker saves per project (workspace settings); 0.2.4 speed too.

Reload VS Code, open the Readback view in the activity bar, set the key,
install the hook, then run a Claude Code turn in the integrated terminal.
The Output panel's "Readback" channel logs every payload and decision.
