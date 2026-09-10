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
 */
import { Buffer } from "node:buffer";
import * as vscode from "vscode";
import { readSettings, SECRET_KEY, writeSetting } from "./config.ts";
import { isWebMessage, type HostMessage, type WebCommand } from "./protocol.ts";
import { renderParagraph, type RenderCache } from "./render.ts";
import { TtsError } from "./speechify.ts";
import type { Turn } from "./turns.ts";

const KEEP_TURNS = 50;

export class PlayerView implements vscode.WebviewViewProvider {
  static readonly viewId = "readback.player";

  private view: vscode.WebviewView | null = null;
  private turns: Turn[] = [];
  private inFlight = new Map<string, Promise<void>>();
  /** The page has loaded and said so. Before that, posts are dropped by VS Code. */
  private ready = false;
  /** Turns pushed while the page was not ready; they autoplay on arrival. */
  private awaiting = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cache: RenderCache,
    private readonly log: vscode.LogOutputChannel,
    private readonly hookInstalled: () => boolean,
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
          return;
        case "need":
          void this.serve(raw.turnId, raw.index);
          return;
        case "note":
          this.log.info(`player: ${raw.text}`);
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

  /** A new turn to read. Reveals the view once so its audio element exists. */
  async push(turn: Turn): Promise<void> {
    this.turns.push(turn);
    if (this.turns.length > KEEP_TURNS) this.turns.splice(0, this.turns.length - KEEP_TURNS);
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

  stop(): void {
    this.post({ kind: "stop" });
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
      voice: settings.voice,
      speed: settings.speed,
      autoplay: settings.autoplay,
      hookInstalled: this.hookInstalled(),
    });
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
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
    const settings = readSettings();
    const started = Date.now();
    try {
      const rendered = await renderParagraph(text, {
        apiBase: settings.apiBase,
        apiKey,
        voiceId: settings.voice,
        model: settings.model,
      }, this.cache);
      this.log.info(`rendered ${id(turnId, index)} in ${Date.now() - started} ms, ${rendered.durationMs} ms of audio, ${rendered.marks.length} marks`);
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
    <button id="back" class="icon" title="Back a sentence"><i class="codicon codicon-chevron-left"></i></button>
    <button id="toggle" class="icon primary" title="Play or pause"><i class="codicon codicon-play"></i></button>
    <button id="fwd" class="icon" title="Forward a sentence"><i class="codicon codicon-chevron-right"></i></button>
    <button id="stop" class="icon" title="Stop"><i class="codicon codicon-debug-stop"></i></button>
    <span class="spacer"></span>
    <button id="autoplay" class="icon toggle" title="Autoplay new replies"><i class="codicon codicon-play-circle"></i></button>
    <button id="speed" class="pill" title="Speed">1×</button>
    <button id="voice" class="pill" title="Choose voice"><i class="codicon codicon-unmute"></i><span id="voiceName"></span></button>
  </div>
  <div id="progress"><div id="progressFill"></div></div>
  <div id="status"></div>
</header>
<section id="setup" hidden></section>
<main id="turns"></main>
<p id="empty">Nothing yet. Finish a Claude Code turn in this project, or select text and run Readback: Read selection.</p>
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
