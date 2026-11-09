# Readback

Hear Claude's replies in a Speechify voice, with each word lit above the
prompt as it is spoken. Readback is open source (MIT), made by Speechify.
The same reader is also a VS Code extension; the source of both is at
<https://github.com/Speechify-AI/readback>.

Readback is also a Claude Code plugin: a band above the prompt shows the
reply and lights each word as it is spoken. It needs Claude Code 2.1.275 or
later, in the terminal or the desktop app. In T3 Code and other hosts that
draw no band, `/readback play` and the other words below take the keys'
place.

```
/plugin marketplace add Speechify-AI/readback
/plugin install readback@readback
```

On Claude Code 2.1.275 or later the one-step form
`/plugin install readback --marketplace Speechify-AI/readback` should also
work; it has not been tried.

The install dialog asks for your Speechify API key. Create one for free at
<https://platform.speechify.ai/api-keys?utm_source=github&utm_medium=readme&utm_campaign=readback>.
The key is stored as a sensitive plugin setting and billed to your own
workspace; change it any time in `/plugin`.

- `/readback on` and `/readback off` turn Readback on or off; bare
  `/readback` prints the status (on or off, voice, speed, what is playing).
  Turning on checks the key against the live API. Nothing plays or bills
  until you press play. On or off is read when a session starts, so turning
  it off in one terminal leaves sessions already open on until they restart.
- `/readback play`, `pause`, `resume`, `stop` and `full` do what the
  band's buttons do, for a host that draws no band (T3 Code and other SDK
  hosts); each word does what it says and nothing else. There a
  new session sleeps until `/readback` is typed once, since nothing tells
  it from a script's headless run, so its first reply is not heard. With
  `auto on` it starts at once instead, and so does any headless `claude -p`
  run on the machine while autoplay stays on.
- `/readback again` plays the last reply from its start. The render is
  cached, so a replay costs nothing.
- `/readback auto on` plays each reply as it lands, as if you had pressed
  play; off by default, and every reply then renders and bills.
- Typing the next prompt stops whatever is playing, as in the extension.
- With autoplay on, the notes Claude writes between tool calls are read as
  they land, as the extension reads them; the finished reply follows.
  Stop (2) during a turn keeps its later notes quiet; the reply still plays.
- One alert is spoken, on by default: a permission prompt that has waited
  a few seconds for you ("Claude is waiting for your permission to run npm
  install"). `/readback alerts off` silences it. It is one short render
  per tool call, cached after the first time.
- `/readback voice` opens a voice picker in the band: a search field and
  the matching voices, featured first. The band lists 64 at a time; type
  to narrow. `/readback voice harper` (a name, language or tag) picks the
  first match by word, where no band draws. The choice is this project's;
  `/readback voice default harper` sets the voice for projects without
  one, and `/readback voice reset` drops this project's. `/readback voice
  random` draws a voice in your language that no project uses yet,
  featured first; run it again for another. A voice per project tells
  sessions apart by ear.
- Each reply opens with the project's folder name, as in the extension,
  so you know which session is speaking.
- `/readback speed 1.25` sets the speed (0.75 to 2), and the band's speed
  button steps through the same values. Speechify renders the rate into
  the audio, so a changed speed re-renders: what was loaded is dropped and
  1 plays the turn again at the new rate.
- Keys 1, 2 and 3 play or pause, stop, and play the full reply. They work
  only while the prompt is empty: a "1" typed as the first character of a
  message goes to Readback, not to Claude.
- While Readback is on, the plugin adds a short section to the system
  prompt asking Claude to end each long reply with a spoken note, an HTML
  comment holding one to three sentences for the ear. That note is what is
  read, at once, with no second run. A long reply without one is condensed
  with `claude -p` on your own Claude subscription when the turn ends. The
  full reply is one press of 3 away either way. Condensing needs the
  `claude` CLI and has been checked on macOS only; on Windows a reply
  without a note is read in full.
- Several Claude Code sessions share one speaker. Pressing play in one
  pauses another, which resumes once the first is done. A reply that lands
  while another session is speaking waits its turn instead of cutting in;
  the band says "waiting for another session to finish" meanwhile.
- Renders are cached under `~/.readback/claude-code/renders`, so replaying
  costs nothing.

The VS Code extension and the plugin are independent; use either or both.
With both, a reply is read once: the plugin stays quiet when a VS Code
window with that project open is listening, and reads as usual when VS
Code is closed or open on another project.

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
