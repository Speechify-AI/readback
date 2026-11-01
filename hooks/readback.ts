/**
 * Readback inside Claude Code: wiring only. Every decision about data is in
 * `mod/app.ts`; playback is `mod/player.ts`, one speaker across sessions is
 * `mod/floor.ts`, the band is `mod/band.ts`. This module hands them `$`.
 *
 * Hooks registered here cannot be removed, so the loop guard is `app`, which
 * every hook checks first: null until a person is found and no `READBACK_HOOK`
 * (the condensing child's marker). A person is at the prompt at
 * `session.start`, or arrives with the desktop app at `session.attach`
 * (`startPlan`, `startsOnAttach` in `mod/app.ts`).
 *
 * Besides replies it speaks two alerts (`mod/alerts.ts`): a permission
 * prompt that has waited for the person (`classic.Notification` of type
 * `permission_prompt`, the tool named by the `tool.check` that asked) and a
 * Bash call that ran past half a minute (`tool.call` timed).
 * A typed prompt stops what is playing. While Readback is on,
 * `prompt.compose` adds the spoken-note section, so the model condenses its
 * own long replies and no `claude -p` run is needed for them.
 */
import type { EngineInterface, Register } from "claude-code";
import type { Voice } from "../src/speechifyShared.ts";
import { SPOKEN_NOTE_INSTRUCTION } from "../src/summaryShared.ts";
import {
  API_BASE,
  MODEL,
  NO_VOICES,
  EXTENSION_READING,
  OFF,
  PICK,
  PICK_NO_BAND,
  WELCOME,
  alertsText,
  apiKeyFrom,
  autoText,
  bandMode,
  claimsFloor,
  errorText,
  fallbackVoice,
  hasBand,
  homeFrom,
  isRefusal,
  keyCheckText,
  nextRate,
  onText,
  pickedVoice,
  platformFrom,
  playbackText,
  readbackCommand,
  replyTurn,
  speedLabel,
  speedSetText,
  startPlan,
  startsOnAttach,
  statusText,
  stopsOnTurnStart,
  storedAlerts,
  storedAuto,
  storedSpeed,
  storedVoice,
  summaryFrom,
  clocksWanted,
  ttsConfig,
  versionFrom,
  voiceSetText,
  type StoredVoice,
} from "../mod/app.ts";
import { longToolText, longToolWorthSaying, permissionText, permissionWorthSaying, promptWaiting } from "../mod/alerts.ts";
import { band, noticeBand, voicePicker, type BandActions, type Els } from "../mod/band.ts";
import { base64Of } from "../mod/bytes.ts";
import { CACHE_DIR, diskCache, renderParagraph, type Files } from "../mod/cache.ts";
import { condenseReply, type Run } from "../mod/condense.ts";
import { ENDPOINTS_DIR, extensionListening } from "../mod/extension.ts";
import { Floor, HEARTBEAT_MS } from "../mod/floor.ts";
import { Player } from "../mod/player.ts";
import { checkKey, listVoices, synthesize, type Http, type Sleep } from "../mod/speechify.ts";

/** What one session's Readback holds; it goes with the `App` at the next start. */
type AppState = {
  enabled: boolean;
  /** A refused key's message, held in the band until Readback is turned on again. */
  notice: string | null;
  picking: boolean;
  pickerVoice: string;
  /** What the picker's search field holds. */
  pickerQuery: string;
  /** Playback rate, one of RATES; rendered in through SSML prosody. */
  speed: number;
  /** Play each reply as it lands, as if play were pressed; stored under `auto`. */
  auto: boolean;
  /** Speak the permission and long-command alerts; stored under `alerts`, on unless false. */
  alerts: boolean;
  /** The voices this key renders on the model, fetched once. */
  voices: Voice[] | null;
  /** The busy spinner's frame, advanced by the tick. */
  frame: number;
  /** The extension-is-reading notice has been shown once this session. */
  toldExtension: boolean;
  /** The last reply went to the extension and nothing newer has been loaded. */
  yielded: boolean;
};

type App = {
  state: AppState;
  player: Player;
  actions: BandActions;
  /** The voices this key renders on the model, fetched once. */
  catalogue(): Promise<Voice[]>;
  currentVoice(): Promise<StoredVoice>;
  version(): Promise<string>;
  http: Http;
  setSpeed(rate: number): Promise<void>;
  condense(text: string): Promise<string | null>;
  report(err: unknown): void;
  /** Whether the VS Code extension's listener answers, so it reads this session and the mod must not. */
  extensionReading(): Promise<boolean>;
  /** The band's Play/Pause/Resume and Full reply buttons, awaited. */
  press(action: "toggle" | "full"): Promise<void>;
  /** The latest reply from its start, whatever is loaded. */
  again(): Promise<void>;
  /** One sentence of Readback's own, rendered and played now; what was playing pauses and resumes after. */
  alert(text: string): Promise<void>;
  /** Stop the player, cancel its timers, give up the floor; never throws. */
  close(): Promise<void>;
};

let app: App | null = null;
/** An SDK host's session with no surface yet: started by the first attach that draws the band. */
let waiting = false;

function build(
  $: EngineInterface,
  apiKey: string | null,
  session: string,
  home: string,
  platform: string,
  enabled: boolean,
  speed: number,
  auto: boolean,
  alerts: boolean,
): App {
  const state: AppState = { enabled, notice: null, picking: false, pickerVoice: "", pickerQuery: "", voices: null, frame: 0, speed, auto, alerts, toldExtension: false, yielded: false };
  const http: Http = (url, init) => $.http.fetch(url, init);
  const sleep: Sleep = (ms) => $.clock.sleep(ms);
  const run: Run = (argv, init) => $.process.run(argv, init);
  const files: Files = {
    read: (path) => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
  };
  const cache = diskCache(files, `${home}/${CACHE_DIR}`);
  // Only a window on this session's project reads the reply; another's would not, and nor would we.
  const extensionReading = async () =>
    extensionListening(
      { list: (dir) => $.fs.list(dir), read: (path) => $.fs.read(path), fetch: (url) => $.http.fetch(url) },
      `${home}/${ENDPOINTS_DIR}`,
      await $.session.cwd(),
      home,
    );

  let versionRead: Promise<string> | null = null;
  const version = () =>
    (versionRead ??= $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(versionFrom, () => "unknown"));

  let fetching: Promise<Voice[]> | null = null;
  const catalogue = async (): Promise<Voice[]> => {
    if (state.voices) return state.voices;
    if (!apiKey) throw new Error("no key");
    // Nothing awaited between the null check and the assignment, so three
    // renders asking at once share one catalogue walk.
    const v = await version();
    fetching ??= listVoices({ apiBase: API_BASE, apiKey, model: MODEL }, http, v).finally(() => {
      fetching = null;
    });
    state.voices = await fetching;
    return state.voices;
  };

  const fallback = fallbackVoice(
    async () => ((await $.settings.read()) as { language?: unknown }).language,
    catalogue,
  );
  const currentVoice = async (): Promise<StoredVoice> => {
    const stored = storedVoice(await $.store.get("voice"));
    if (stored) return stored;
    return fallback();
  };

  const floor = new Floor(
    { get: (key) => $.store.get(key), set: (key, value) => $.store.set(key, value) },
    session,
    () => $.clock.now(),
  );

  // Two clocks: the tick (the highlight while sound plays, the spinner while
  // loading or condensing) and the heartbeat, which holds the floor.
  let tick: { cancel(): void } | null = null;
  let heartbeat: { cancel(): void } | null = null;
  const stopTimers = () => {
    tick?.cancel();
    tick = null;
    heartbeat?.cancel();
    heartbeat = null;
  };
  const beat = async () => {
    if ((await floor.beat()) === "lost") {
      // Pausing and unloading announce themselves through onChange; a render
      // still in flight does not, so resync here: its spinner keeps turning
      // until it lands paused, and the clocks stop then.
      player.preempt();
      syncTimers();
      $.ui.invalidate("ui.render");
    }
  };
  const syncTimers = () => {
    const wanted = clocksWanted(player.view().state);
    if (wanted) {
      tick ??= $.clock.every(100, () => {
        state.frame++;
        void player.tick().then(() => $.ui.invalidate("ui.render"));
      });
    } else if (tick) {
      tick.cancel();
      tick = null;
    }
    if (wanted) {
      heartbeat ??= $.clock.every(HEARTBEAT_MS, () => {
        beat().catch(() => {});
      });
    } else if (heartbeat) {
      heartbeat.cancel();
      heartbeat = null;
    }
  };

  const report = (err: unknown) => {
    const text = errorText(err);
    if (isRefusal(err)) {
      state.enabled = false;
      state.picking = false;
      state.notice = text;
      void $.store.set("enabled", false);
      void floor.release().catch(() => {});
    }
    $.ui.toast(text);
    $.ui.invalidate("ui.render");
  };

  const player: Player = new Player({
    render: async (text) => {
      if (!apiKey) throw new Error("no key");
      const cfg = ttsConfig(apiKey, await currentVoice());
      const v = await version();
      return renderParagraph(text, cfg, cache, (input, c) => synthesize(input, c, http, sleep, v), state.speed);
    },
    play: (bytes, signal) => $.audio.play({ base64: base64Of(bytes), mime: "audio/mpeg" }, { signal }),
    now: () => $.clock.now(),
    onChange: () => {
      syncTimers();
      $.ui.invalidate("ui.render");
    },
    onError: report,
  });

  const press = async (action: "toggle" | "full") => {
    if (claimsFloor(player.view().state, action, player.hasLatest, player.resuming)) await floor.claim();
    if (action === "toggle") await player.toggle();
    else await player.playFull();
  };
  /** A new rate is a new render: what was loaded is dropped, and 1 plays the turn again at the new speed. */
  const setSpeed = async (rate: number) => {
    state.speed = rate;
    player.stop();
    await $.store.set("speed", rate);
    $.ui.invalidate("ui.render");
  };
  const actions: BandActions = {
    toggle: () => void press("toggle").catch(report),
    stop: () => player.stop(),
    full: () => void press("full").catch(report),
    speed: () => void setSpeed(nextRate(state.speed)).catch(report),
  };
  const again = async () => {
    player.stop();
    await press("toggle");
  };

  // An alert is one paragraph rendered as any other (so a repeated sentence
  // is a cached render) and played outside the player: it is not a turn, and
  // the latest reply stays what it was. A reply playing pauses for it and
  // resumes after, unless the person pressed something meanwhile.
  const alert = async (text: string) => {
    if (!apiKey || !state.enabled || !state.alerts) return;
    const cfg = ttsConfig(apiKey, await currentVoice());
    const v = await version();
    const rendered = await renderParagraph(text, cfg, cache, (input, c) => synthesize(input, c, http, sleep, v), state.speed);
    const wasPlaying = player.view().state === "playing";
    if (wasPlaying) await player.toggle();
    await $.audio.play({ base64: base64Of(rendered.audio), mime: "audio/mpeg" });
    if (wasPlaying && player.view().state === "paused") await player.toggle();
  };

  return {
    state,
    player,
    actions,
    catalogue,
    currentVoice,
    version,
    http,
    setSpeed,
    condense: (text) => condenseReply(text, { run, home, platform, now: () => $.clock.now() }),
    report,
    extensionReading,
    press,
    again,
    alert,
    close: async () => {
      try {
        player.stop();
        stopTimers();
        await floor.release();
      } catch {
        // a failed teardown must not throw out of the hook
      }
    },
  };
}

/** A person is here: the welcome once, and this session's app. */
async function start($: EngineInterface, apiKey: string | null): Promise<void> {
  if ((await $.store.get("welcomed")) !== true) {
    $.ui.toast(WELCOME);
    await $.store.set("welcomed", true);
  }
  const enabled = (await $.store.get("enabled")) === true && apiKey !== null;
  const home = homeFrom(await $.env.get("HOME"), await $.env.get("USERPROFILE"));
  const platform = platformFrom(await $.env.get("OS"));
  app = build(
    $,
    apiKey,
    await $.session.id(),
    home,
    platform,
    enabled,
    storedSpeed(await $.store.get("speed")),
    storedAuto(await $.store.get("auto")),
    storedAlerts(await $.store.get("alerts")),
  );
  // Probed again at every turn.complete; here so the band is hidden from
  // the first frame in a window the extension already reads.
  if (enabled) app.state.yielded = await app.extensionReading();
  $.ui.invalidate("ui.render");
}

/**
 * The main loop's calls whose verdict was `ask`, by id, until each ends: the
 * tool to name when the prompt is reported waiting, `said` once it has been,
 * and a long wait on one is not a long command.
 */
const asked = new Map<string, { tool: string; input: unknown; said: boolean }>();

export const register: Register = (on, options) => {
  const apiKey = apiKeyFrom(options);

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    // A second start in this module (/clear gives a new session id): the old
    // player's timers and floor claim must not outlive it, and nothing of
    // its state (a refusal notice, an open picker) carries into the new one.
    const old = app;
    app = null;
    waiting = false;
    await old?.close();
    // On and autoplay both stored: the person has asked to hear each reply,
    // so a surfaceless session does not wait for /readback.
    const wanted = (await $.store.get("enabled")) === true && storedAuto(await $.store.get("auto"));
    const plan = startPlan(await $.env.get("READBACK_HOOK"), e.isInteractive, wanted);
    if (plan === "off") return result;
    // Registered while waiting too: on an SDK host with no surface (T3 Code),
    // the person's /readback is what starts it.
    await $.command.register({
      name: "readback",
      description: "Readback status; /readback on, off; play, stop, full, again; voice picks the voice; speed sets it; auto on plays each reply; alerts off silences the alerts",
      argumentHint: "[on|off|play|stop|full|again|voice|speed|auto|alerts]",
      immediate: true,
    });
    if (plan === "start") await start($, apiKey);
    if (plan === "wait") waiting = true;
    return result;
  });

  on("session.attach", async ($, e, next) => {
    if (waiting && startsOnAttach(e.surface)) {
      waiting = false;
      await start($, apiKey);
    }
    return next(e);
  });

  // The person typed the next prompt: what is playing stops, as the
  // extension stops on UserPromptSubmit.
  on("turn.start", ($, e, next) => {
    if (app && e.agentId === undefined && stopsOnTurnStart(e)) app.player.stop();
    return next(e);
  });

  // The system prompt carries the spoken-note section while Readback is on,
  // so a long reply ends with its own summary and no condensing run is needed.
  on("prompt.compose", async ($, e, next) => {
    const result = await next(e);
    if (!app?.state.enabled) return result;
    return { sections: [...result.sections, { id: "readback:spoken-note", text: SPOKEN_NOTE_INSTRUCTION, scope: "session" as const }] };
  });

  // The engine will ask the person: say so, unless the extension is reading
  // this session (it speaks the prompt itself, once it has waited).
  // An ask is remembered, not spoken: in auto mode a classifier answers it.
  on("tool.check", async ($, e, next) => {
    const result = await next(e);
    if (permissionWorthSaying(e, result.decision)) asked.set(e.tool_use_id!, { tool: e.tool, input: e.input, said: false });
    return result;
  });

  // The prompt has waited about six seconds for a person: say so, once.
  on("classic.Notification", async ($, e, next) => {
    const result = await next(e);
    const a = app;
    if (a?.state.enabled && a.state.alerts && promptWaiting(e)) {
      const pending = [...asked.values()].filter((p) => !p.said).pop();
      if (pending) {
        pending.said = true;
        if (!(await a.extensionReading())) a.alert(permissionText(pending.tool, pending.input)).catch(a.report);
      }
    }
    return result;
  });

  // A Bash call timed end to end; a long one is announced when it ends.
  on("tool.call", async ($, e, next) => {
    const started = await $.clock.now();
    const result = await next(e);
    const a = app;
    if (a?.state.enabled && a.state.alerts) {
      const id = e.tool_use_id;
      const waited = asked.delete(id);
      const took = (await $.clock.now()) - started;
      if (longToolWorthSaying(e, took, waited)) a.alert(longToolText(took)).catch(a.report);
    }
    return result;
  });

  on("turn.complete", async ($, e, next) => {
    if (!app || !app.state.enabled) return next(e);
    const result = await next(e);
    const turn = replyTurn(e);
    if (turn && (await app.extensionReading())) {
      app.state.yielded = true;
      if (!app.state.toldExtension) {
        app.state.toldExtension = true;
        $.ui.toast(EXTENSION_READING);
      }
      return result;
    }
    if (turn) {
      const a = app;
      a.state.yielded = false;
      a.player.setLatest(turn);
      if (turn.condensing) {
        a.condense(e.answer).then(
          (summary) => a.player.summaryReady(turn.id, summaryFrom(summary)),
          () => a.player.summaryReady(turn.id, null),
        );
      }
      // Autoplay is play pressed for the person: the floor is claimed and a
      // condensing turn waits for its summary as it would by hand.
      if (a.state.auto) a.press("toggle").catch(a.report);
    }
    return result;
  });

  // Our own command, registered only when not off, so it is answered here and
  // never passed on: a `next(e)` would make this hook a gate on it.
  on("command.run", { command: "readback" }, ($, e) => {
    const answer = async (): Promise<{ text?: string }> => {
      if (!app && waiting) {
        waiting = false;
        await start($, apiKey);
      }
      const a = app;
      if (!a) return {};
      const plan = readbackCommand(e.args, apiKey, a.state.enabled, a.state.speed);
      switch (plan.kind) {
        case "text":
          return { text: plan.text };
        case "status":
          return {
            text: statusText(a.state.enabled, await a.currentVoice(), a.state.speed, a.player.view().state, a.player.hasLatest, a.state.auto, a.state.alerts),
          };
        case "auto":
          if (plan.on !== null) {
            a.state.auto = plan.on;
            await $.store.set("auto", plan.on);
          }
          return { text: autoText(a.state.auto) };
        case "alerts":
          if (plan.on !== null) {
            a.state.alerts = plan.on;
            await $.store.set("alerts", plan.on);
          }
          return { text: alertsText(a.state.alerts) };
        case "again":
          await a.again();
          return { text: playbackText(a.player.view().state, a.player.hasLatest, a.state.yielded) };
        case "off":
          a.state.enabled = false;
          a.state.picking = false;
          await $.store.set("enabled", false);
          await a.close();
          $.ui.invalidate("ui.render");
          return { text: OFF };
        case "on": {
          const check = await checkKey(plan.key, { apiBase: API_BASE, model: MODEL }, a.http, await a.version());
          if (!check.ok) return { text: keyCheckText(check) };
          a.state.voices = check.voices;
          a.state.enabled = true;
          a.state.notice = null;
          await $.store.set("enabled", true);
          $.ui.invalidate("ui.render");
          return { text: onText(hasBand(await $.session.surfaces())) };
        }
        case "toggle":
        case "full":
          await a.press(plan.kind);
          return { text: playbackText(a.player.view().state, a.player.hasLatest, a.state.yielded) };
        case "stop":
          a.player.stop();
          return { text: playbackText(a.player.view().state, a.player.hasLatest, a.state.yielded) };
        case "voice": {
          let voices: Voice[];
          try {
            voices = await a.catalogue();
          } catch {
            return { text: NO_VOICES };
          }
          if (plan.query !== "") {
            const { voice, text } = voiceSetText(voices, plan.query);
            if (voice) await $.store.set("voice", pickedVoice(voices, voice.id));
            return { text };
          }
          if (!hasBand(await $.session.surfaces())) return { text: PICK_NO_BAND };
          a.state.pickerVoice = (await a.currentVoice()).id;
          a.state.pickerQuery = "";
          a.state.picking = true;
          $.ui.invalidate("ui.render");
          return { text: PICK };
        }
        case "speed":
          await a.setSpeed(plan.rate);
          return { text: speedSetText(plan.rate, hasBand(await $.session.surfaces())) };
      }
    };
    return answer().catch((err: unknown) => ({ text: errorText(err) }));
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (!app) return next(e);
    const a = app;
    const { state } = a;
    const mode = bandMode({ hasSurvey: e.props.hasSurvey, enabled: state.enabled, notice: state.notice, picking: state.picking, yielded: state.yielded });
    if (mode === "pass") return next(e);
    const els = $.ui.resolve(e) as unknown as Els;
    if (mode === "notice") return noticeBand(state.notice!, els) as ReturnType<typeof next>;
    if (mode === "picker" && state.voices) {
      const list = state.voices;
      const close = () => {
        state.picking = false;
        $.ui.invalidate("ui.render");
      };
      return voicePicker(list, state.pickerVoice, state.pickerQuery, els, {
        pick: (id) => {
          close();
          $.store.set("voice", pickedVoice(list, id)).catch(a.report);
        },
        search: (query) => {
          state.pickerQuery = query;
          $.ui.invalidate("ui.render");
        },
        cancel: close,
      }) as ReturnType<typeof next>;
    }
    return band(a.player.view(), els, a.actions, a.state.frame, a.state.speed) as ReturnType<typeof next>;
  });

  on("session.end", async ($, e, next) => {
    await app?.close();
    return next(e);
  });
};
