# Readback

Hear your AI coding agent's replies in a Speechify voice, with the words
highlighted as they are spoken.

Claude Code finishes a turn. Readback condenses the reply to a few spoken
sentences and reads them back to you in the VS Code sidebar, lighting up
each word as it is said. The full reply is one click away. Click a word to
jump to it. Step by sentence. Cycle the speed. Pick any voice your Speechify
key can render, including your own clone.

## Install

Paste this into Claude Code:

> Install the Readback VS Code extension, then run its "Install the Claude
> Code hook" command and tell me when it is done.

Or by hand: install the extension, then either answer the prompt that
appears on first start, click **Readback** in the status bar, or run
**Readback: Set Speechify API key** from the Command Palette. Then press
**Install the hook** in the Readback view.

You need a Speechify API key. Create one at
<https://platform.speechify.ai/api-keys>. Readback keeps it in VS Code's
secret storage and every reply you listen to bills your own workspace.

## How it works

- A `Stop` hook in `~/.claude/settings.json` posts each finished turn to
  Readback. The hook is ten lines of POSIX shell and curl. It needs no
  runtime on your PATH and never decides anything itself.
- Readback condenses the reply with `claude -p` on the smallest model, on
  your own Claude subscription, so it holds no model key. The run loads no
  settings and is marked so the hook ignores it, which is what stops a
  reply about a reply. If `claude` is missing or the run fails, you hear
  the full reply instead. Turn it off with `readback.summarize`.
- Readback flattens the text to plain prose (code blocks become "code
  omitted", tables a short note, links their text), splits it into
  paragraphs, and synthesizes each one through `/v1/audio/speech` as the
  player reaches it.
- Speech marks come back with character offsets into the exact text sent,
  and that is what drives the highlight. No guessing, no token alignment.
- Renders are cached on disk by text, voice and model. Replaying is free.
  Changing voice re-renders.

## Commands

| Command | What it does |
| --- | --- |
| Readback: Set Speechify API key | Checks the key against the live API before storing it |
| Readback: Choose voice | Lists the voices on your key that can render the model |
| Readback: Install the Claude Code hook | Adds one Stop hook, leaving the rest of the file alone |
| Readback: Remove the Claude Code hook | Removes exactly that hook |
| Readback: Read selection | Reads the editor selection. Also in the editor context menu |
| Readback: Stop | Stops playback and clears the queue |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `readback.summarize` | `claude` | Condense replies with `claude -p`, or `off` to read them in full |
| `readback.voice` | `harper_32` | Speechify voice id |
| `readback.model` | `simba-3.2` | Speechify model |
| `readback.speed` | `1` | Playback rate, also cycled from the player |
| `readback.minChars` | `80` | Replies shorter than this are skipped |
| `readback.maxChars` | `4000` | Longer replies are cut at a sentence and end with "and more" |

## Several windows

Each window shows and speaks only its own project's turns. A turn belongs
to a window when the folder Claude Code ran in is inside one of its
workspace folders, or contains one (running Claude at a monorepo's root
while the window has a sub-project open is the same project). A turn that
matches no open window is not read.

## The player

Play, pause, back and forward a sentence, stop. Space, left and right do
the same when the player has focus. The progress line tracks the current
paragraph. The speed pill cycles from 0.75× to 2×; the voice pill opens
the voice picker. Each turn has its own play button, and a condensed turn
has a "Full reply" section with one of its own.

## Limits

- Claude Code is the only source in this version. The hook fires for
  sessions in a terminal; whether it fires from the Claude Code panel in
  VS Code depends on the extension version you run.
- The hook is a shell script, so macOS and Linux. Windows needs a
  PowerShell hook, which does not exist yet.
- Read-along needs speech marks, which the streaming endpoint does not
  return, so replies are read paragraph by paragraph at up to 2,000
  characters per request.

## Develop

```sh
npm install
npm run typecheck && npm test
npm run build          # dist/extension.js
npm run package        # readback-<version>.vsix
```

Press F5 in VS Code to run the extension in a development host.

MIT. Built by Speechify. The player's icons are VS Code's
[codicons](https://github.com/microsoft/vscode-codicons) (CC BY 4.0).
