# Readback

Hear Claude's replies in a Speechify voice, with each word lit above the
prompt as it is spoken. Readback is open source (MIT), made by Speechify.
The same reader is also a VS Code extension; the source of both is at
<https://github.com/Speechify-AI/readback>.

<!-- section: Claude Code -->

## What leaves your machine

- **To Speechify.** The text Readback speaks goes to
  `https://api.speechify.ai/v1/audio/speech` with your API key, the voice
  and the model: a reply or its spoken summary, a progress note, the
  project's folder name, or a permission alert naming the tool that waits.
  Turning Readback on and opening the voice picker call
  `https://api.speechify.ai/v1/voices` with the key. Requests carry
  `Speechify-Caller: readback` and the plugin's version. Nothing is sent
  before you turn Readback on. After that, a reply is rendered only when
  you press play or have turned autoplay on; the permission alert, on by
  default, renders when a prompt has waited for you
  (`/readback alerts off` stops it). Speechify's privacy policy applies:
  <https://speechify.com/privacy/>.
- **To Claude, on your own subscription.** A long reply without its own
  spoken note is condensed by running `claude -p --model sonnet` on your
  machine with the reply on stdin. That run loads no settings and no hooks.
- **Into the system prompt.** While Readback is on, it adds a short section
  asking Claude to end each long reply with a spoken note, an HTML comment
  of one to three sentences. Readback hides the note in the transcript.
- **On your machine only.** Rendered audio and speech marks are cached
  under `~/.readback/claude-code/renders`. To keep a reply from being read
  twice, Readback lists `~/.readback/endpoints` (written by the VS Code
  extension) and sends an empty request to `http://127.0.0.1:<port>/turn`
  for each window listed there. It reads Claude Code's `language` setting
  to pick a default voice. Your choices (on or off, voice, speed, autoplay,
  alerts) stay in the plugin's own store, and the key only in Claude Code's
  sensitive plugin settings. Readback writes no file outside that cache.
- **Programs it starts.** Only `claude`, for the condensing run above.

Readback collects no analytics and sends nothing anywhere else.

## Hooks

Readback is a mod: one hooks module, `hooks/readback.ts`. What each hook
does:

- `session.start`, `session.attach`, `session.end`: start Readback when a
  person is at the prompt, and stop its player when the session ends.
- `turn.start`: a prompt you type stops whatever is playing.
- `prompt.compose`: while Readback is on, adds the spoken-note section to
  the system prompt. It removes and changes nothing else.
- `turn.step`, `turn.complete`: read the text Claude wrote, to speak a
  progress note or the finished reply. They change nothing.
- `tool.call`: notes which tool call is running, so a permission alert can
  name it. It changes no call and decides no permission.
- `classic.Notification`: when Claude Code reports that a permission prompt
  has waited, speaks one sentence naming the tool.
- `command.run` for `/readback`: answers the command; no other command.
- `ui.render` for `AssistantMessage`: hides the spoken note in the
  transcript; the stored message keeps it. For `AbovePrompt`: draws the
  band with the controls and the sentence being spoken.

## License

MIT. See `LICENSE`.
