# Readback

Hear your AI coding agent's replies in a Speechify voice, with the words
highlighted as they are spoken.

Claude Code works through a task. Readback reads the notes Claude writes
between tool calls as they land, then condenses the finished reply to a few
spoken sentences, all in the VS Code sidebar with each word lit as it is
said. The full reply is one click away. Click a word to jump to it. Step by
sentence. Cycle the speed. Pick any voice your Speechify key can render,
including your own clone, and hear a sample of each before you choose.

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

After a reload, click once anywhere in the VS Code window before you
expect to hear anything. The browser inside VS Code keeps audio silent
until then, and the player shows a card until it has played once. Replies
that arrive before that queue up.

## How it works

- Five hooks in `~/.claude/settings.json`, `MessageDisplay`, `PreToolUse`,
  `Notification`, `UserPromptSubmit` and `Stop`, post each assistant
  message, each tool call, each permission prompt left waiting, each prompt
  of yours and each finished turn to Readback. The hook is ten lines of
  POSIX shell and curl (the same lines in PowerShell on Windows). It needs
  no runtime on your PATH and never decides anything itself.
- Codex CLI can be a second source: a `Stop` hook in `~/.codex/hooks.json`
  posts each finished turn the same way. Codex has no per-message hook, so
  its notes between tool calls are not read. See Codex below.
- A message followed by a tool call was a note written before it, and
  Readback reads it as it stands while the tool runs. A message followed by
  Stop is the finished reply and gets condensed, unless it is under 500
  characters already, which is read as it stands. Turn the notes off with
  `readback.progress`.
- A permission prompt that has waited about six seconds (Claude Code's own
  threshold for the `permission_prompt` notification) is read at once, ahead
  of whatever is playing: "Claude is waiting for your permission to run npm
  install, in readback." The tool call comes from the `PreToolUse` that
  preceded it. Whatever was playing carries on afterwards. Turn it off with
  `readback.alerts`.
- When you submit your next prompt, Readback stops reading: the reply it
  was on has been read. A reply still being condensed when you type lands
  in the list without playing.
- Each turn opens with a one-word lead-in, the project's name, that renders
  once and plays from the cache, so you hear that a turn has started within
  a few milliseconds while its first paragraph renders. The time is shown
  next to it, not spoken.
- Readback condenses the reply with `claude -p` on Sonnet, on
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
| Readback: Choose voice | Opens the picker in the panel: featured voices first, then every voice grouped by language, with search, filters by gender, clone or tag, and a sample of each. Saved for the open project; set `readback.voice` in user settings for the default |
| Readback: Install the Claude Code hook | Adds Stop, MessageDisplay, PreToolUse, Notification and UserPromptSubmit hooks, leaving the rest of the file alone |
| Readback: Remove the Claude Code hook | Removes exactly that hook |
| Readback: Install the Codex hook | Adds a Stop hook to `~/.codex/hooks.json`. Also a row in the settings panel when a `~/.codex` folder exists |
| Readback: Remove the Codex hook | Removes exactly that hook |
| Readback: Catch me up | One briefing of every listed reply you have not heard. The history button in the bar does the same |
| Readback: Read selection | Reads the editor selection. Also in the editor context menu |
| Readback: Stop | Stops playback and clears the queue |
| Readback: Clear the list | Forgets every listed reply. The trash button in the bar does the same |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `readback.autoplay` | `true` | Play each new reply as it arrives; off lists them and waits for play |
| `readback.summarize` | `claude` | Condense replies with `claude -p`, or `off` to read them in full |
| `readback.progress` | `true` | Read the notes Claude writes between tool calls as they arrive |
| `readback.alerts` | `true` | Say when Claude has been waiting for your permission for a few seconds, ahead of whatever is playing |
| `readback.voice` | `harper_32` | Speechify voice id. Per project when set from the picker. Unset, and Claude Code's `language` is German, Spanish, French, Italian or Portuguese, a voice in that language is used |
| `readback.model` | `simba-3.2` | Speechify model for English voices. Other voices render on `simba-3.0`, the model that speaks their language |
| `readback.speed` | `1` | Playback rate. Per project when cycled from the player |
| `readback.minChars` | `80` | Replies shorter than this are skipped |
| `readback.maxChars` | `4000` | Longer replies are cut at a sentence and end with "and more" |

## Languages

Readback speaks whatever language Claude writes in, as long as the voice
speaks it too. Voices exist for English, German, Spanish (Spain and
Mexico), French, Italian and Brazilian Portuguese. English voices render
on `simba-3.2`; the others on `simba-3.0`, which is the model that speaks
them. The voice's locale goes with every request.

To have Claude answer in Spanish, add `language` to
`~/.claude/settings.json`, or to a project's `.claude/settings.json` for
that project only:

```json
{
  "language": "spanish"
}
```

Claude Code applies it straight away. Readback reads the same setting:

- If you have not picked a voice, it uses one in that language.
- If you have, it keeps yours. The voice picker lists that language first
  and says when your voice speaks a different one. Pick a voice from that
  group.

The condensed summary is written in the reply's language, so it matches
what Claude wrote. The catch-up lead-in ("Catching up on 3 replies") is
still English. If Claude writes in a language no voice speaks, such as
Japanese, the reply is read by your voice anyway and will not sound right.

## Several windows

Each window shows and speaks only its own project's turns. A turn belongs
to a window when the folder Claude Code ran in is inside one of its
workspace folders, or contains one (running Claude at a monorepo's root
while the window has a sub-project open is the same project). A turn that
matches no open window is not read.

## Catching up

A reply counts as heard when it started playing while this VS Code window
was focused. One that played to an empty room, or that waited because
autoplay was off, stays unheard. **Catch me up** (the history button, or
the command) takes every unheard reply in the list, oldest first, and has
`claude -p` brief them together: what landed, what is still open, what
waits on you, grouped by project. The briefing is listed as its own turn
and plays; the replies it covers stay in the list and count as heard.
Without `claude`, or with `readback.summarize` off, the same replies are
read one after another instead. At most 20 are read in detail; older ones
are counted in the lead-in.

## Codex

Open the settings panel and press **Install** on the Codex CLI row, or run
**Readback: Install the Codex hook**. This writes one `Stop` entry to
`~/.codex/hooks.json`, next to whatever is already there. Codex runs a new
hook only after you have trusted it once: open Codex, run `/hooks`, and
approve Readback. Until then nothing arrives. Condensing still runs
through `claude -p` when it is installed; without it Codex replies are read
in full.

## The player

Play, pause, back and forward a sentence, stop. Space, left and right do
the same when the player has focus. The progress line tracks the current
paragraph. The autoplay toggle decides whether a new reply plays at once
or waits, marked with a dot, for you to press play. The speed pill cycles from 0.75× to 2×; the voice pill opens
the voice picker. Each turn has its own play button, and a condensed turn
has a "Full reply" section with one of its own.

## Limits

- Claude Code and Codex CLI are the sources. The Claude Code hook fires
  for sessions in a terminal and in the Claude Code panel in VS Code.
- On Windows the hook is a PowerShell script run through `powershell.exe`
  with no shell in between. It has not yet been tried on a Windows machine
  by us; if you run it there, an issue with what you saw would help.
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
