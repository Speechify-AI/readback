/**
 * Readback: hear your agent's replies in a Speechify voice, words lit as
 * they are spoken.
 *
 * Activation wires four things: the hook script on disk, the loopback
 * listener the hook posts to, the sidebar player, and the commands. The
 * listener starts at activation, not on first use, because a turn can end
 * before anyone opens the view.
 *
 * Payloads go through `LiveTurns`, which turns the stream of MessageDisplay,
 * PreToolUse and Stop events into two kinds of thing: a progress note to
 * read as it stands, and the finished reply to condense. A turn is listed on
 * its first note and grows from there, so what Claude says between tool
 * calls is heard while the tools are still running.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import * as vscode from "vscode";
import {
  HOOK_SCRIPT_NAME,
  hasHook,
  hookScript,
  isClaudeSettings,
  withHook,
  withoutHook,
  type ClaudeSettings,
} from "./claudeSettings.ts";
import { readSettings, SECRET_KEY, writeSetting } from "./config.ts";
import { fileCache } from "./fileCache.ts";
import { startListener, type Listener } from "./listener.ts";
import { LiveTurns, type LiveEvent } from "./live.ts";
import { PlayerView } from "./playerView.ts";
import type { WebCommand } from "./protocol.ts";
import { checkKey, listVoices } from "./speechify.ts";
import { condense, findClaude } from "./summary.ts";
import { decideMessage, makeTurn, PROGRESS_MIN_CHARS, replyParagraphs, type Message } from "./turns.ts";
import { relatedToWorkspace } from "./windows.ts";

const home = homedir();
const readbackHome = process.env.READBACK_HOME ?? join(home, ".readback");
const endpointsDir = join(readbackHome, "endpoints");
const hookPath = join(readbackHome, HOOK_SCRIPT_NAME);
const claudeSettingsPath = join(home, ".claude", "settings.json");

let listener: Listener | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Readback", { log: true });
  context.subscriptions.push(log);

  writeHookScript(log);

  const cache = fileCache(join(context.globalStorageUri.fsPath, "cache"));
  const player = new PlayerView(context, cache, log, hookInstalled, (name) => runWebCommand(name));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PlayerView.viewId, player, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Turns still going, by session and prompt, to the listed turn they grow.
  const openTurns = new Map<string, string>();
  const live = new LiveTurns((event) => onLive(event, player, openTurns, log));
  try {
    listener = await startListener(endpointsDir, (payload) => live.accept(payload));
    log.info(`listening on 127.0.0.1:${listener.port}, endpoint ${listener.endpointFile}`);
  } catch (err) {
    log.error(`listener failed to start: ${String(err)}`);
    void vscode.window.showErrorMessage("Readback could not start its listener. Claude Code turns will not be read.");
  }

  const runWebCommand = (name: WebCommand): void => {
    void vscode.commands.executeCommand(`readback.${name}`);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("readback.setApiKey", () => setApiKey(context, player)),
    vscode.commands.registerCommand("readback.chooseVoice", () => chooseVoice(context, player)),
    vscode.commands.registerCommand("readback.installHook", () => installHook(player, log)),
    vscode.commands.registerCommand("readback.uninstallHook", () => uninstallHook(player, log)),
    vscode.commands.registerCommand("readback.readSelection", () => readSelection(player)),
    vscode.commands.registerCommand("readback.stop", () => player.stop()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("readback")) void player.sendState();
    }),
  );

  // A second way in. The activity bar entry is easy to miss among many
  // extensions, and someone who never opens the view still needs a path to
  // the key.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  status.text = "$(unmute) Readback";
  status.tooltip = "Open the Readback player";
  status.command = `${PlayerView.viewId}.focus`;
  status.show();
  context.subscriptions.push(status);

  void offerKeyOnce(context);
}

/** On the first activation without a key, say what is needed, once. */
async function offerKeyOnce(context: vscode.ExtensionContext): Promise<void> {
  const PROMPTED = "readback.promptedForKey";
  if (await context.secrets.get(SECRET_KEY)) return;
  if (context.globalState.get<boolean>(PROMPTED)) return;
  await context.globalState.update(PROMPTED, true);
  const choice = await vscode.window.showInformationMessage(
    "Readback needs a Speechify API key before it can speak.",
    "Set API key",
    "Open player",
  );
  if (choice === "Set API key") void vscode.commands.executeCommand("readback.setApiKey");
  if (choice === "Open player") void vscode.commands.executeCommand(`${PlayerView.viewId}.focus`);
}

export function deactivate(): void {
  listener?.close();
  listener = null;
}

/** Keep the hook script current; its path is fixed so settings never go stale. */
function writeHookScript(log: vscode.LogOutputChannel): void {
  try {
    mkdirSync(endpointsDir, { recursive: true });
    const wanted = hookScript(endpointsDir);
    const current = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : null;
    if (current !== wanted) {
      writeFileSync(hookPath, wanted);
      log.info(`wrote ${hookPath}`);
    }
    chmodSync(hookPath, 0o755);
  } catch (err) {
    log.error(`could not write the hook script: ${String(err)}`);
  }
}

/**
 * Something the stream assembler decided: a progress note to read now, or
 * the finished reply. Both are filtered by project first, so another
 * window's turn never shows here.
 */
function onLive(event: LiveEvent, player: PlayerView, open: Map<string, string>, log: vscode.LogOutputChannel): void {
  const settings = readSettings();
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  if (!relatedToWorkspace(event.cwd, folders)) {
    log.debug(`a turn from ${event.cwd ?? "?"} is not this window's project`);
    return;
  }
  if (event.kind === "progress") {
    if (!settings.progress) return;
    const decision = decideMessage(event.markdown, event.cwd, { minChars: PROGRESS_MIN_CHARS, maxChars: settings.maxChars });
    if (decision.kind === "skip") {
      log.debug(`skipped a progress note: ${decision.reason}`);
      return;
    }
    void progress(event.key, decision, `released by ${event.via} after ${event.heldMs} ms`, player, open, log);
    return;
  }
  const listed = event.key === null ? null : open.get(event.key) ?? null;
  if (event.key !== null) open.delete(event.key);
  if (event.heldMs !== null) log.info(`Stop came ${event.heldMs} ms after the last message`);
  if (event.markdown === null) {
    log.debug("skipped a payload: no-message");
    return;
  }
  if (event.readAsProgress) {
    log.info(`turn ${listed?.slice(0, 8) ?? "?"} finished; its reply was already read as a note, nothing appended`);
    return;
  }
  const decision = decideMessage(event.markdown, event.cwd, settings);
  if (decision.kind === "skip") {
    log.debug(`skipped a payload: ${decision.reason}`);
    return;
  }
  void speak(decision, listed, player, log);
}

/** A note Claude wrote before a tool call: append it to the turn, or start the turn with it. */
async function progress(
  key: string,
  message: Message,
  how: string,
  player: PlayerView,
  open: Map<string, string>,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const settings = readSettings();
  const listed = open.get(key);
  const { full } = replyParagraphs({ markdown: message.markdown, limits: settings });
  if (listed !== undefined && player.append(listed, full, 0)) {
    log.info(`turn ${listed.slice(0, 8)} grew by ${full.length} progress paragraphs (${how})`);
    return;
  }
  const turn = makeTurn({ markdown: message.markdown, project: message.project, limits: settings });
  if (!turn) return;
  open.set(key, turn.id);
  log.info(`turn from ${turn.project ?? "?"} started with ${turn.paragraphs.length - 1} progress paragraphs (${how})`);
  await player.push(turn);
}

/** The finished reply. Condense if we can, then append it to its turn or list it as a new one. */
async function speak(
  message: Message,
  listed: string | null,
  player: PlayerView,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const settings = readSettings();
  let condensed: string | null = null;
  const claudePath = settings.summarize === "claude" ? findClaude() : null;
  if (settings.summarize === "claude" && claudePath === null) {
    log.warn("summarize is on but no claude binary was found; reading the full reply");
  }
  if (claudePath) {
    player.status(`Condensing a reply from ${message.project ?? "the agent"}…`);
    const started = Date.now();
    condensed = await condense(message.markdown, { claudePath });
    log.info(`condense ${condensed ? "ok" : "failed"} in ${Date.now() - started} ms`);
    if (!condensed) player.status("");
  }
  if (listed !== null) {
    const { summary, full } = replyParagraphs({ markdown: message.markdown, summary: condensed, limits: settings });
    if (player.append(listed, [...summary, ...full], summary.length)) {
      log.info(`turn ${listed.slice(0, 8)} finished with ${full.length} paragraphs${summary.length > 0 ? " (condensed)" : ""}`);
      return;
    }
  }
  const turn = makeTurn({ markdown: message.markdown, summary: condensed, project: message.project, limits: settings });
  if (!turn) return;
  log.info(`turn from ${turn.project ?? "?"}, ${turn.paragraphs.length - 1} paragraphs${turn.fullFrom ? " (condensed)" : ""}`);
  await player.push(turn);
}

async function setApiKey(context: vscode.ExtensionContext, player: PlayerView): Promise<void> {
  const settings = readSettings();
  const entered = await vscode.window.showInputBox({
    title: "Speechify API key",
    prompt: "Create one at platform.speechify.ai/api-keys. It is stored in VS Code's secret storage.",
    password: true,
    ignoreFocusOut: true,
  });
  if (entered === undefined) return;
  const check = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Checking the key with Speechify" },
    () => checkKey(entered, settings.apiBase, settings.model),
  );
  if (!check.ok) {
    void vscode.window.showErrorMessage(check.reason);
    return;
  }
  await context.secrets.store(SECRET_KEY, entered.trim());
  if (!check.voices.some((v) => v.id === settings.voice)) {
    const [first] = check.voices;
    if (first) await writeSetting("voice", first.id);
  }
  await player.sendState();
  void vscode.window.showInformationMessage(`Readback is ready. ${check.voices.length} voices can render ${settings.model}.`);
}

async function chooseVoice(context: vscode.ExtensionContext, player: PlayerView): Promise<void> {
  const apiKey = await context.secrets.get(SECRET_KEY);
  if (!apiKey) {
    void vscode.window.showWarningMessage("Set your Speechify API key first.");
    return;
  }
  const settings = readSettings();
  const voices = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Fetching voices" },
    () => listVoices({ apiBase: settings.apiBase, apiKey, model: settings.model }).catch(() => []),
  );
  if (voices.length === 0) {
    void vscode.window.showErrorMessage(`No voice on this key can render ${settings.model}.`);
    return;
  }
  const hasProject = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const picked = await vscode.window.showQuickPick(
    voices.map((v) => ({
      label: v.name,
      description: v.id === settings.voice ? "current" : v.cloned ? "your clone" : v.locale,
      id: v.id,
    })),
    {
      title: `Voices for ${settings.model}`,
      placeHolder: hasProject ? "Saved for this project" : "Saved as your default",
    },
  );
  if (!picked) return;
  await writeSetting("voice", picked.id, "project");
  await player.sendState();
}

function readClaudeSettings(): ClaudeSettings | null {
  if (!existsSync(claudeSettingsPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(claudeSettingsPath, "utf8"));
  return isClaudeSettings(parsed) ? parsed : null;
}

function hookInstalled(): boolean {
  try {
    const settings = readClaudeSettings();
    return settings !== null && hasHook(settings, hookPath);
  } catch {
    return false;
  }
}

async function installHook(player: PlayerView, log: vscode.LogOutputChannel): Promise<void> {
  await editClaudeSettings((s) => withHook(s, hookPath), log);
  await player.sendState();
  if (hookInstalled()) {
    void vscode.window.showInformationMessage("Readback hook installed. Claude Code picks it up on its next session.");
  }
}

async function uninstallHook(player: PlayerView, log: vscode.LogOutputChannel): Promise<void> {
  await editClaudeSettings((s) => withoutHook(s, hookPath), log);
  await player.sendState();
}

async function editClaudeSettings(
  edit: (settings: ClaudeSettings) => ClaudeSettings,
  log: vscode.LogOutputChannel,
): Promise<void> {
  let settings: ClaudeSettings | null;
  try {
    settings = readClaudeSettings();
  } catch (err) {
    log.error(`could not parse ${claudeSettingsPath}: ${String(err)}`);
    settings = null;
  }
  if (settings === null) {
    void vscode.window.showErrorMessage(
      `Readback could not read ${claudeSettingsPath} as JSON, so it left the file alone.`,
    );
    return;
  }
  const next = edit(settings);
  if (next === settings) return;
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(claudeSettingsPath, `${JSON.stringify(next, null, 2)}\n`);
  log.info(`updated ${claudeSettingsPath}`);
}

async function readSelection(player: PlayerView): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const text = editor?.document.getText(editor.selection) ?? "";
  if (text.trim() === "") {
    void vscode.window.showInformationMessage("Select some text first.");
    return;
  }
  const settings = readSettings();
  const project = editor ? basename(editor.document.fileName) : null;
  const turn = makeTurn({ markdown: text, project, limits: { minChars: 1, maxChars: settings.maxChars } });
  if (turn) await player.push(turn);
}
