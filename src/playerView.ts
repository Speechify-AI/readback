/**
 * The sidebar player. Owns the list of turns for this window, feeds the
 * webview, and renders paragraphs on demand.
 *
 * The webview pulls: it asks for a paragraph when the playhead is about to
 * need it. The host renders (cache first), and posts the bytes back. A
 * turn nobody plays past its first paragraph costs one paragraph.
 *
 * A turn can grow while it is listed: progress notes are appended as Claude
 * writes them, and the finished reply last. The stored turn is the truth;
 * the webview is told what was added and where.
 *
 * A turn counts as heard when it started playing while the VS Code window
 * was focused. Played to an empty room, or listed while autoplay was off, it
 * stays unheard, which is what a catch-up covers.
 *
 * The voice picker lives in the webview too. The host fetches the catalogue
 * for the current model and, on request, a sample of one voice: the
 * catalogue's own preview when it has one, else one short line synthesized
 * in that voice, which goes through the render cache so it bills once.
 *
 * Every render looks its voice up in the same catalogue, because the voice's
 * locale picks the model and the language sent (`modelFor`, `languageFor`).
 * Until a voice is chosen, Claude Code's own `language` setting picks the
 * default one (`claudeLanguage.ts`).
 */
import { Buffer } from "node:buffer";
import { homedir } from "node:os";
import * as vscode from "vscode";
import { defaultVoice, languageCode, readClaudeLanguage } from "./claudeLanguage.ts";
import { readSettings, SECRET_KEY, writeSetting } from "./config.ts";
import { isWebMessage, type CodexState, type HostMessage, type WebCommand } from "./protocol.ts";
import { renderParagraph, type RenderCache } from "./render.ts";
import { languageFor, listVoices, modelFor, TtsError, type TtsConfig, type Voice } from "./speechify.ts";
import type { Turn } from "./turns.ts";

const KEEP_TURNS = 50;
/** How long a fetched catalogue is reused before asking Speechify again. */
const VOICES_TTL_MS = 10 * 60 * 1000;
/** Spoken in a voice that has no catalogue preview. Short: it bills once per voice. */
export const SAMPLE_LINE = "Hi, this is how your replies will sound. The tests pass and two files changed.";

export class PlayerView implements vscode.WebviewViewProvider {
  static readonly viewId = "readback.player";

  private view: vscode.WebviewView | null = null;
  private turns: Turn[] = [];
  /** Ids of listed turns that played while the window was focused. */
  private heard = new Set<string>();
  private inFlight = new Map<string, Promise<void>>();
  /** The page has loaded and said so. Before that, posts are dropped by VS Code. */
  private ready = false;
  /** Turns pushed while the page was not ready; they autoplay on arrival. */
  private awaiting = new Set<string>();
  private voices: { at: number; scope: string; list: Voice[] } | null = null;
  /** A catalogue fetch under way, shared by everything that asks meanwhile. */
  private fetchingVoices: { scope: string; job: Promise<Voice[]> } | null = null;
  /** The picker was asked for before the page was ready; open it on ready. */
  private showVoicesWhenReady = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cache: RenderCache,
    private readonly log: vscode.LogOutputChannel,
    private readonly hookInstalled: () => boolean,
    private readonly codexState: () => CodexState,
    private readonly runCommand: (name: WebCommand) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((raw: unknown) => {
      if (!isWebMessage(raw)) {
        this.log.warn("webview sent something unexpected", raw);
        return;
      }
      switch (raw.kind) {
        case "ready":
          this.ready = true;
          this.log.info("player ready");
          void this.sendState();
          // Oldest first so the newest lands on top. A turn that arrived
          // while the page was loading still autoplays; the rest are history.
          for (const turn of this.turns) {
            this.post({ kind: "turn", turn, autoplay: this.awaiting.delete(turn.id) });
          }
          if (this.showVoicesWhenReady) {
            this.showVoicesWhenReady = false;
            this.post({ kind: "showVoices" });
          }
          return;
        case "need":
          void this.serve(raw.turnId, raw.index);
          return;
        case "note":
          this.log.info(`player: ${raw.text}`);
          return;
        case "heard":
          if (vscode.window.state.focused) this.heard.add(raw.turnId);
          else this.log.debug(`turn ${raw.turnId.slice(0, 8)} played while the window was not focused; still unheard`);
          return;
        case "speed":
          void writeSetting("speed", raw.rate, "project");
          return;
        case "autoplay":
          void writeSetting("autoplay", raw.on);
          return;
        case "command":
          this.runCommand(raw.name);
          return;
        case "clear":
          // The page has already emptied itself.
          this.forget();
          return;
        case "voices":
          void this.sendVoices();
          return;
        case "sample":
          void this.sample(raw.voiceId);
          return;
        case "voice":
          void writeSetting("voice", raw.id, "project").then(() => this.sendState());
          return;
        default: {
          const _exhaustive: never = raw;
          return _exhaustive;
        }
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = null;
        this.ready = false;
        this.log.info("player view disposed");
      }
    });
  }

  /** A new turn to read. Reveals the view once so its audio element exists. A catch-up is heard by definition. */
  async push(turn: Turn, opts: { heard?: boolean } = {}): Promise<void> {
    this.turns.push(turn);
    if (opts.heard) this.heard.add(turn.id);
    if (this.turns.length > KEEP_TURNS) {
      this.turns.splice(0, this.turns.length - KEEP_TURNS);
      for (const id of this.heard) if (!this.turns.some((t) => t.id === id)) this.heard.delete(id);
    }
    if (this.ready) {
      this.post({ kind: "turn", turn, autoplay: true });
      return;
    }
    // The page will ask for its turns when it has loaded; mark this one to
    // autoplay then. Revealing the view is what creates the page.
    this.awaiting.add(turn.id);
    this.log.info(`player not ready; revealing the view for turn ${turn.id.slice(0, 8)}`);
    await vscode.commands.executeCommand(`${PlayerView.viewId}.focus`);
  }

  /**
   * More of a turn that is still going: progress notes as they arrive, then
   * the finished reply. The first `summaryCount` paragraphs are the condensed
   * reply; what follows them is the full reply, which plays only when asked,
   * as in `push`. False when the turn is no longer listed, so the caller
   * starts a new one instead.
   */
  append(turnId: string, paragraphs: string[], summaryCount: number): boolean {
    const turn = this.turns.find((t) => t.id === turnId);
    if (!turn) return false;
    if (paragraphs.length === 0) return true;
    const from = turn.paragraphs.length;
    if (summaryCount > 0) turn.fullFrom = from + summaryCount;
    turn.paragraphs.push(...paragraphs);
    if (this.ready) {
      this.post({ kind: "append", turnId, from, paragraphs, fullFrom: turn.fullFrom, autoplay: true });
    } else {
      // The page gets the whole turn when it loads; make sure it autoplays then.
      this.awaiting.add(turnId);
    }
    return true;
  }

  /** Listed turns nobody has heard, oldest first. */
  unheard(): Turn[] {
    return this.turns.filter((t) => !this.heard.has(t.id));
  }

  markHeard(ids: Iterable<string>): void {
    for (const id of ids) this.heard.add(id);
  }

  stop(): void {
    this.post({ kind: "stop" });
  }

  /** Forget every turn and empty the page, from the command. */
  clear(): void {
    this.forget();
    this.post({ kind: "clear" });
  }

  private forget(): void {
    const count = this.turns.length;
    this.turns = [];
    this.heard.clear();
    this.awaiting.clear();
    this.log.info(`cleared ${count} turns`);
  }

  /** Open the voice picker, from the command. Waits for the page if it is still loading. */
  showVoices(): void {
    if (this.ready) this.post({ kind: "showVoices" });
    else this.showVoicesWhenReady = true;
  }

  /** The key changed: the catalogue it listed no longer applies. */
  forgetVoices(): void {
    this.voices = null;
    this.fetchingVoices = null;
  }

  /** A line in the bar while something is happening off screen. */
  status(text: string): void {
    this.post({ kind: "status", text });
  }

  async sendState(): Promise<void> {
    const key = await this.context.secrets.get(SECRET_KEY);
    const settings = readSettings();
    this.post({
      kind: "state",
      keyOk: Boolean(key),
      voice: key ? await this.voiceId(key) : settings.voice,
      speed: settings.speed,
      autoplay: settings.autoplay,
      hookInstalled: this.hookInstalled(),
      codex: this.codexState(),
    });
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private async sendVoices(): Promise<void> {
    const settings = readSettings();
    const claudeLanguage = this.claudeLanguage();
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      this.post({ kind: "voices", voices: [], error: "Set your Speechify API key first.", claudeLanguage });
      return;
    }
    try {
      const list = await this.catalogue(apiKey);
      this.post({ kind: "voices", voices: list, error: list.length === 0 ? `No voice on this key can render ${settings.model}.` : null, claudeLanguage });
    } catch (err) {
      this.log.error(`voices failed: ${describe(err)}`);
      this.post({ kind: "voices", voices: this.voices?.list ?? [], error: describe(err), claudeLanguage });
    }
  }

  /** Claude Code's `language` as a code a voice here speaks ("es"), or null. Read fresh: the person may change it any time. */
  private claudeLanguage(): string | null {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const value = readClaudeLanguage(homedir(), folders);
    return value === null ? null : languageCode(value);
  }

  /**
   * The voice to speak in: the one chosen in any settings scope, else a
   * stock voice in Claude's language when that is not English, else the
   * `readback.voice` default. Nothing is written; picking a voice ends it.
   */
  private async voiceId(apiKey: string): Promise<string> {
    const settings = readSettings();
    const set = vscode.workspace.getConfiguration("readback").inspect<string>("voice");
    if (set?.globalValue ?? set?.workspaceValue ?? set?.workspaceFolderValue) return settings.voice;
    const code = this.claudeLanguage();
    if (code === null || code === "en") return settings.voice;
    try {
      return defaultVoice(await this.catalogue(apiKey), code)?.id ?? settings.voice;
    } catch {
      return settings.voice;
    }
  }

  /** The voices this key can render, fetched at most once per `VOICES_TTL_MS`. Throws when Speechify cannot be reached. */
  private catalogue(apiKey: string): Promise<Voice[]> {
    const settings = readSettings();
    const scope = `${settings.apiBase} ${settings.model}`;
    const cached = this.voices;
    if (cached && cached.scope === scope && Date.now() - cached.at < VOICES_TTL_MS) return Promise.resolve(cached.list);
    if (this.fetchingVoices?.scope === scope) return this.fetchingVoices.job;
    const job = listVoices({ apiBase: settings.apiBase, apiKey, model: settings.model }).then((list) => {
      this.voices = { at: Date.now(), scope, list };
      this.log.info(`${list.length} voices for ${settings.model}, ${list.filter((v) => v.preview).length} with previews`);
      return list;
    });
    const fetching = { scope, job };
    this.fetchingVoices = fetching;
    const done = () => {
      if (this.fetchingVoices === fetching) this.fetchingVoices = null;
    };
    job.then(done, done);
    return job;
  }

  /**
   * What to render this voice with: its model and language come from its
   * locale in the catalogue. A voice the catalogue lacks, or no catalogue,
   * renders on the configured model with no language, as before.
   */
  private async ttsConfig(apiKey: string, voiceId: string): Promise<TtsConfig> {
    const settings = readSettings();
    let locale = "";
    try {
      locale = (await this.catalogue(apiKey)).find((v) => v.id === voiceId)?.locale ?? "";
    } catch (err) {
      this.log.warn(`no catalogue for ${voiceId}, rendering on ${settings.model}: ${describe(err)}`);
    }
    return { apiBase: settings.apiBase, apiKey, voiceId, model: modelFor(locale, settings.model), language: languageFor(locale) };
  }

  private async sample(voiceId: string): Promise<void> {
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      this.post({ kind: "sample", voiceId, audio: null, error: "Set your Speechify API key first." });
      return;
    }
    const voice = this.voices?.list.find((v) => v.id === voiceId);
    const started = Date.now();
    try {
      let audio: Uint8Array;
      let source: string;
      if (voice?.preview) {
        const res = await fetch(voice.preview);
        if (!res.ok) throw new Error(`preview answered ${res.status}`);
        audio = new Uint8Array(await res.arrayBuffer());
        source = "preview";
      } else {
        const rendered = await renderParagraph(SAMPLE_LINE, await this.ttsConfig(apiKey, voiceId), this.cache);
        audio = rendered.audio;
        source = "synthesized";
      }
      this.log.info(`sample of ${voiceId} (${source}) in ${Date.now() - started} ms`);
      this.post({ kind: "sample", voiceId, audio: Buffer.from(audio).toString("base64"), error: null });
    } catch (err) {
      this.log.error(`sample of ${voiceId} failed: ${describe(err)}`);
      this.post({ kind: "sample", voiceId, audio: null, error: describe(err) });
    }
  }

  private async serve(turnId: string, index: number): Promise<void> {
    const id = `${turnId}:${index}`;
    const pending = this.inFlight.get(id);
    if (pending) return pending;
    const job = this.render(turnId, index).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, job);
    return job;
  }

  private async render(turnId: string, index: number): Promise<void> {
    const text = this.turns.find((t) => t.id === turnId)?.paragraphs[index];
    if (text === undefined) return;
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      this.log.warn(`no API key; cannot render ${id(turnId, index)}`);
      this.post({ kind: "error", turnId, index, message: "Set your Speechify API key first." });
      return;
    }
    const cfg = await this.ttsConfig(apiKey, await this.voiceId(apiKey));
    const started = Date.now();
    try {
      const rendered = await renderParagraph(text, cfg, this.cache);
      this.log.info(`rendered ${id(turnId, index)} on ${cfg.model}${cfg.language ? ` (${cfg.language})` : ""} in ${Date.now() - started} ms, ${rendered.durationMs} ms of audio, ${rendered.marks.length} marks`);
      this.post({
        kind: "audio",
        turnId,
        index,
        audio: Buffer.from(rendered.audio).toString("base64"),
        marks: rendered.marks,
        durationMs: rendered.durationMs,
      });
    } catch (err) {
      const message = describe(err);
      this.log.error(`render failed for ${id(turnId, index)}: ${message}`);
      this.post({ kind: "error", turnId, index, message });
    }
  }

  private html(webview: vscode.Webview): string {
    const media = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", file)).toString();
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; media-src blob:; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media("codicons/codicon.css")}">
<link rel="stylesheet" href="${media("player.css")}">
<title>Readback</title>
</head>
<body>
<header id="bar">
  <div class="transport">
    <div class="cluster">
      <button id="back" class="icon" title="Back a sentence (←)" aria-label="Back a sentence"><i class="codicon codicon-debug-step-back"></i></button>
      <button id="toggle" class="icon primary" title="Play or pause (space)" aria-label="Play or pause"><i class="codicon codicon-play"></i></button>
      <button id="fwd" class="icon" title="Forward a sentence (→)" aria-label="Forward a sentence"><i class="codicon codicon-debug-step-over"></i></button>
      <button id="stop" class="icon" title="Stop" aria-label="Stop"><i class="codicon codicon-debug-stop"></i></button>
    </div>
    <div class="cluster secondary">
      <button id="catchUp" class="icon" title="Catch me up: one briefing of the replies you have not heard" aria-label="Catch me up"><i class="codicon codicon-history"></i></button>
      <button id="settings" class="icon" title="Settings: voice, speed, autoplay" aria-label="Settings"><i class="codicon codicon-settings-gear"></i></button>
      <button id="clear" class="icon" title="Clear the list" aria-label="Clear the list"><i class="codicon codicon-clear-all"></i></button>
    </div>
  </div>
  <div id="progress"><div id="progressFill"></div></div>
  <div id="status"></div>
</header>
<section id="setup" hidden></section>
<section id="settingsPanel" class="panel" hidden>
  <div class="panel-head"><h2>Settings</h2><button id="settingsClose" class="icon" title="Back to the replies" aria-label="Back to the replies"><i class="codicon codicon-close"></i></button></div>
  <div class="setting" id="voiceSetting" role="button" tabindex="0">
    <div class="setting-text"><div class="setting-label">Voice</div><div class="setting-help" id="voiceCurrent"></div></div>
    <span class="setting-action">Change <i class="codicon codicon-chevron-right"></i></span>
  </div>
  <div class="setting">
    <div class="setting-text"><div class="setting-label">Speed</div><div class="setting-help">Playback rate, saved for this project</div></div>
    <div class="segmented" id="speedSeg"></div>
  </div>
  <div class="setting">
    <div class="setting-text"><div class="setting-label">Autoplay</div><div class="setting-help" id="autoplayHelp"></div></div>
    <button id="autoplaySwitch" class="switch" role="switch" aria-checked="true" aria-label="Autoplay"><span></span></button>
  </div>
  <div class="setting" id="keySetting" role="button" tabindex="0">
    <div class="setting-text"><div class="setting-label">Speechify API key</div><div class="setting-help" id="keyHelp"></div></div>
    <span class="setting-action" id="keyAction">Change <i class="codicon codicon-chevron-right"></i></span>
  </div>
  <div class="setting" id="codexSetting" hidden>
    <div class="setting-text"><div class="setting-label">Codex CLI</div><div class="setting-help" id="codexHelp"></div></div>
    <button id="codexAction" class="action"></button>
  </div>
  <button id="allSettings" class="text-link"><i class="codicon codicon-settings"></i>All Readback settings<i class="codicon codicon-link-external"></i></button>
</section>
<section id="voices" class="panel" hidden>
  <div class="voices-head">
    <button id="voicesBack" class="icon" title="Back to settings" aria-label="Back to settings"><i class="codicon codicon-arrow-left"></i></button>
    <input id="voiceSearch" type="search" placeholder="Search voices" autocomplete="off" spellcheck="false">
    <button id="voicesClose" class="icon" title="Back to the replies" aria-label="Back to the replies"><i class="codicon codicon-close"></i></button>
  </div>
  <div id="voiceFilters" class="chips"></div>
  <div id="voiceList"></div>
</section>
<main id="turns"></main>
<p id="empty">Nothing to hear yet. Replies from Claude Code, or Codex once its hook is installed, appear here for this project as they come in. To hear anything else, select some text and run <b>Readback: Read selection</b>.</p>
<script type="module" nonce="${nonce}" src="${media("player.js")}"></script>
</body>
</html>`;
  }
}

const id = (turnId: string, index: number): string => `${turnId.slice(0, 8)}#${index}`;

function describe(err: unknown): string {
  if (err instanceof TtsError) {
    if (err.status === 401 || err.status === 403) return "Speechify refused the API key. Set it again.";
    if (err.status === 402) return "The Speechify workspace is out of credit.";
    if (err.status === 429) return "Speechify is rate limiting. Try again in a moment.";
    return `Speechify answered ${err.status}.`;
  }
  return err instanceof Error ? err.message : String(err);
}
