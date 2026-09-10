# Readback reads Claude Code's replies aloud

Claude Code takes a few minutes on anything worth delegating. You start a task, switch to another window, and come back to a screen of markdown that landed while you were elsewhere. Or you don't come back. You're making coffee and the reply just sits there.

Readback is a VS Code extension for the second case, and it takes the sting out of the first. When Claude Code finishes a turn, Readback condenses the reply to a sentence or two, reads it in a Speechify voice, and highlights each word in the sidebar as it is spoken. The full reply is one click away, read the same way. It is open source under MIT and on the VS Code Marketplace today.

## What it sounds like

A turn ends. Ten or fifteen seconds later a voice says something like "Moved the settings merge into its own module and added tests for the malformed JSON case. The Windows hook is still open." That's the whole interruption. If you want everything, press play under "Full reply" and the same voice reads it paragraph by paragraph with the words lighting up as they go. Click a word to jump to it. The arrow keys step by sentence. The speed pill cycles from 0.75x to 2x.

Claude does the condensing itself. Readback runs `claude -p` on Haiku with the reply on stdin and a short brief. One to three sentences, past tense, what was done and what still needs a decision. That run uses your own Claude subscription, so Readback never holds a model key. If `claude` is not on your PATH or the run fails, you hear the full reply instead. Set `readback.summarize` to `off` if you would rather always hear everything.

## How it is wired

Claude Code has a Stop hook that runs when a turn finishes. Readback installs one. It is ten lines of POSIX shell and curl:

```sh
#!/bin/sh
[ -n "$READBACK_HOOK" ] && exit 0
dir="$HOME/.readback/endpoints"
[ -d "$dir" ] || exit 0
payload=$(cat)
for f in "$dir"/*; do
  [ -f "$f" ] || continue
  read -r port token < "$f" || continue
  printf '%s' "$payload" | curl -s -o /dev/null -m 5 -X POST \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
    --data-binary @- "http://127.0.0.1:$port/turn"
  [ $? -eq 7 ] && rm -f "$f"
done
exit 0
```

The hook decides nothing. It forwards the payload to every Readback listener on the machine and exits 0 whatever happens. The extension decides which window speaks, whether a reply is long enough to bother with, and what gets read, so the hook never needs updating in step with it.

Every VS Code window hears every turn, and each window speaks only its own project's. A turn belongs to a window when the folder Claude ran in is inside one of its workspace folders, or contains one. There is no fallback to the focused window. A panel full of another project's replies is worse than silence.

The condensing run cannot feed back into Readback. It loads no settings, so no Stop hook fires from it, and it carries an environment marker the hook script checks on its first line. Either guard alone would do. Both means a hook installed some other way still cannot produce a reply about a reply.

## The part that is about the API

We built Readback partly as a small, working example of what the Speechify API gives you beyond an MP3. The read-along is the interesting bit.

`/v1/audio/speech` returns audio plus speech marks, and each mark carries character offsets into the exact string you sent. Readback flattens the markdown to plain prose first. Code blocks become "code omitted", a table becomes a short note, links become their text. It sends that string and paints the same string in the webview. The highlight is anchored on those offsets. No token alignment, no guessing which word the voice is on. What is shown is what is spoken, so the offsets cannot drift.

Two facts about the endpoint shaped the design. It caps a request at 2,000 characters, so the paragraph is the unit of rendering, and a long paragraph is split with its marks shifted by measured audio duration. And the streaming endpoint does not return marks, so Readback does not use it. Instead, nothing renders ahead of the player. The webview asks for a paragraph when the playhead is about to need it, plus two more. A turn you stop after one sentence costs you one sentence.

Renders are cached on disk under a hash of the text, the voice and the model. Replaying is free. Switching voice re-renders rather than serving the wrong narrator. Any voice your key can render shows up in the picker, including a clone of your own.

## Install

Paste this into Claude Code:

> Install the Readback VS Code extension, then run its "Install the Claude Code hook" command and tell me when it is done.

Or install it by hand from the Marketplace and press "Install the hook" in the Readback view. You need a Speechify API key from [platform.speechify.ai/api-keys](https://platform.speechify.ai/api-keys). Readback checks the key against the live API before storing it in VS Code's secret storage, and never writes it anywhere else. Every reply you listen to bills your own workspace.

## What it does not do yet

Claude Code is the only source. The hook is a shell script, so macOS and Linux only. Windows needs a PowerShell version that does not exist yet. The extension is on the VS Code Marketplace, and Cursor users will have to wait for the Open VSX listing. Whether the Stop hook fires from Claude Code's own panel inside VS Code, rather than a terminal, depends on the Claude Code version you run.

The code is at [github.com/Speechify-AI/readback](https://github.com/Speechify-AI/readback). Bugs and pull requests go there.
