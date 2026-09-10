/**
 * Readback: hear your agent's replies in a Speechify voice, words lit as
 * they are spoken.
 *
 * Activation wires four things: the hook script on disk, the loopback
 * listener the hook posts to, the sidebar player, and the commands. The
 * listener starts at activation, not on first use, because a turn can end
 * before anyone opens the view.
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
import { PlayerView } from "./playerView.ts";
import type { WebCommand } from "./protocol.ts";
import { checkKey, listVoices } from "./speechify.ts";
import { condense, findClaude } from "./summary.ts";
import { isStopPayload, makeTurn, messageFromStop } from "./turns.ts";
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

  try {
    listener = await startListener(endpointsDir, (payload) => onPayload(payload, player, log));
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

function onPayload(payload: unknown, player: PlayerView, log: vscode.LogOutputChannel): void {
  if (!isStopPayload(payload)) return;
  const settings = readSettings();
  const decision = messageFromStop(payload, settings);
  if (decision.kind === "skip") {
    log.debug(`skipped a payload: ${decision.reason}`);
    return;
  }
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  if (!relatedToWorkspace(decision.cwd, folders)) {
    log.debug(`a turn from ${decision.cwd ?? "?"} is not this window's project`);
    return;
  }
  void speak(decision, player, log);
}

/** Condense if we can, then hand the turn to the player. */
async function speak(
  message: { markdown: string; project: string | null },
  player: PlayerView,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const settings = readSettings();
  let summary: string | null = null;
  const claudePath = settings.summarize === "claude" ? findClaude() : null;
  if (settings.summarize === "claude" && claudePath === null) {
    log.warn("summarize is on but no claude binary was found; reading the full reply");
  }
  if (claudePath) {
    player.status(`Condensing a reply from ${message.project ?? "the agent"}…`);
    const started = Date.now();
    summary = await condense(message.markdown, { claudePath });
    log.info(`condense ${summary ? "ok" : "failed"} in ${Date.now() - started} ms`);
    if (!summary) player.status("");
  }
  const turn = makeTurn({ markdown: message.markdown, summary, project: message.project, limits: settings });
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
  const picked = await vscode.window.showQuickPick(
    voices.map((v) => ({
      label: v.name,
      description: v.id === settings.voice ? "current" : v.cloned ? "your clone" : v.locale,
      id: v.id,
    })),
    { title: `Voices for ${settings.model}` },
  );
  if (!picked) return;
  await writeSetting("voice", picked.id);
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
