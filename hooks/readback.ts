/**
 * Readback inside Claude Code: wiring only. Every decision about data is in
 * `mod/app.ts`; playback is `mod/player.ts`, one speaker across sessions is
 * `mod/floor.ts`, the band is `mod/band.ts`. This module hands them `$`.
 *
 * Hooks registered here cannot be removed, so the loop guard is `app`, which
 * every hook checks first: null until `session.start` finds a person at the
 * prompt and no `READBACK_HOOK` (the condensing child's marker).
 */
import type { EngineInterface, Register } from "claude-code";
import type { Voice } from "../src/speechifyShared.ts";
import {
  API_BASE,
  MODEL,
  NO_VOICES,
  OFF,
  ON,
  PICK,
  WELCOME,
  apiKeyFrom,
  bandMode,
  claimsFloor,
  errorText,
  fallbackVoice,
  homeFrom,
  isRefusal,
  keyCheckText,
  loopGuard,
  nextRate,
  pickedVoice,
  platformFrom,
  readbackCommand,
  replyTurn,
  speedLabel,
  storedSpeed,
  storedVoice,
  summaryFrom,
  clocksWanted,
  ttsConfig,
  versionFrom,
  type StoredVoice,
} from "../mod/app.ts";
import { band, noticeBand, voicePicker, type BandActions, type Els } from "../mod/band.ts";
import { base64Of } from "../mod/bytes.ts";
import { CACHE_DIR, diskCache, renderParagraph, type Files } from "../mod/cache.ts";
import { condenseReply, type Run } from "../mod/condense.ts";
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
  /** The voices this key renders on the model, fetched once. */
  voices: Voice[] | null;
  /** The busy spinner's frame, advanced by the tick. */
  frame: number;
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
  /** Stop the player, cancel its timers, give up the floor; never throws. */
  close(): Promise<void>;
};

let app: App | null = null;

function build(
  $: EngineInterface,
  apiKey: string | null,
  session: string,
  home: string,
  platform: string,
  enabled: boolean,
  speed: number,
): App {
  const state: AppState = { enabled, notice: null, picking: false, pickerVoice: "", pickerQuery: "", voices: null, frame: 0, speed };
  const http: Http = (url, init) => $.http.fetch(url, init);
  const sleep: Sleep = (ms) => $.clock.sleep(ms);
  const run: Run = (argv, init) => $.process.run(argv, init);
  const files: Files = {
    read: (path) => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
  };
  const cache = diskCache(files, `${home}/${CACHE_DIR}`);

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

export const register: Register = (on, options) => {
  const apiKey = apiKeyFrom(options);

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    // A second start in this module (/clear gives a new session id): the old
    // player's timers and floor claim must not outlive it, and nothing of
    // its state (a refusal notice, an open picker) carries into the new one.
    const old = app;
    app = null;
    await old?.close();
    if (loopGuard(await $.env.get("READBACK_HOOK"), e.isInteractive)) return result;
    await $.command.register({
      name: "readback",
      description: "Turn Readback on or off; /readback voice picks the voice",
      argumentHint: "[voice]",
      immediate: true,
    });
    if ((await $.store.get("welcomed")) !== true) {
      $.ui.toast(WELCOME);
      await $.store.set("welcomed", true);
    }
    const enabled = (await $.store.get("enabled")) === true && apiKey !== null;
    const home = homeFrom(await $.env.get("HOME"), await $.env.get("USERPROFILE"));
    const platform = platformFrom(await $.env.get("OS"));
    app = build($, apiKey, await $.session.id(), home, platform, enabled, storedSpeed(await $.store.get("speed")));
    $.ui.invalidate("ui.render");
    return result;
  });

  on("turn.complete", async ($, e, next) => {
    if (!app || !app.state.enabled) return next(e);
    const result = await next(e);
    const turn = replyTurn(e);
    if (turn) {
      const a = app;
      a.player.setLatest(turn);
      if (turn.condensing) {
        a.condense(e.answer).then(
          (summary) => a.player.summaryReady(turn.id, summaryFrom(summary)),
          () => a.player.summaryReady(turn.id, null),
        );
      }
    }
    return result;
  });

  // Our own command, registered only when not off, so it is answered here and
  // never passed on: a `next(e)` would make this hook a gate on it.
  on("command.run", { command: "readback" }, ($, e) => {
    if (!app) return Promise.resolve({});
    const a = app;
    const plan = readbackCommand(e.args, apiKey, a.state.enabled, a.state.speed);
    const answer = async (): Promise<{ text: string }> => {
      switch (plan.kind) {
        case "text":
          return { text: plan.text };
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
          return { text: ON };
        }
        case "voice": {
          try {
            await a.catalogue();
          } catch {
            return { text: NO_VOICES };
          }
          a.state.pickerVoice = (await a.currentVoice()).id;
          a.state.pickerQuery = "";
          a.state.picking = true;
          $.ui.invalidate("ui.render");
          return { text: PICK };
        }
        case "speed":
          await a.setSpeed(plan.rate);
          return { text: `Speed is ${speedLabel(plan.rate)}. Press 1 to hear it.` };
      }
    };
    return answer().catch((err: unknown) => ({ text: errorText(err) }));
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (!app) return next(e);
    const a = app;
    const { state } = a;
    const mode = bandMode({ hasSurvey: e.props.hasSurvey, enabled: state.enabled, notice: state.notice, picking: state.picking });
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
