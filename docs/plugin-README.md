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
  sensitive plugin settings.

Readback collects no analytics and sends nothing anywhere else.

## License

MIT. See `LICENSE`.
