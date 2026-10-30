/**
 * Readback inside Claude Code: wiring only. Every decision about data is in
 * `mod/app.ts`; playback is `mod/player.ts`, one speaker across sessions is
 * `mod/floor.ts`, the band is `mod/band.ts`. This module hands them `$`.
 *
 * Hooks registered here cannot be removed, so the loop guard is the `off`
 * flag every hook checks first: off until `session.start` finds a person at
 * the prompt and no `READBACK_HOOK` (the condensing child's marker).
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
  chooseVoice,
  claimsFloor,
  errorText,
  homeFrom,
  isRefusal,
  keyCheckText,
  loopGuard,
  pickedVoice,
  platformFrom,
  readbackCommand,
  replyTurn,
  storedVoice,
  summaryFrom,
  timersWanted,
  ttsConfig,
  versionFrom,
  type StoredVoice,
} from "../mod/app.ts";
import { band, noticeBand, voicePicker, type BandActions, type Els } from "../mod/band.ts";
import { toBase64 } from "../mod/bytes.ts";
import { CACHE_DIR, diskCache, renderParagraph, type Files } from "../mod/cache.ts";
import { condenseReply, type Run } from "../mod/condense.ts";
import { Floor, HEARTBEAT_MS } from "../mod/floor.ts";
import { Player } from "../mod/player.ts";
import { checkKey, listVoices, synthesize, type Http, type Sleep } from "../mod/speechify.ts";

type App = {
  player: Player;
  floor: Floor;
  actions: BandActions;
  /** The voices this key renders on the model, fetched once. */
  catalogue(): Promise<Voice[]>;
  currentVoice(): Promise<StoredVoice>;
  version(): Promise<string>;
  http: Http;
  condense(text: string): Promise<string | null>;
  report(err: unknown): void;
  stopTimers(): void;
  /** Stop the player, cancel its timers, give up the floor; never throws. */
  close(): Promise<void>;
};

let off = true;
let enabled = false;
/** A refused key's message, held in the band until Readback is turned on again. */
let notice: string | null = null;
let picking = false;
let pickerVoice = "";
let voices: Voice[] | null = null;
let app: App | null = null;

function build($: EngineInterface, apiKey: string | null, session: string, home: string, platform: string): App {
  const http: Http = (url, init) => $.http.fetch(url, init);
  const sleep: Sleep = (ms) => $.clock.sleep(ms);
  const run: Run = (argv, init) => $.process.run(argv, init);
  const files: Files = {
    read: (path) => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    exists: (path) => $.fs.exists(path),
  };
  const cache = diskCache(files, `${home}/${CACHE_DIR}`);

  let versionRead: Promise<string> | null = null;
  const version = () =>
    (versionRead ??= $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(versionFrom, () => "unknown"));

  let fetching: Promise<Voice[]> | null = null;
  const catalogue = async (): Promise<Voice[]> => {
    if (voices) return voices;
    if (!apiKey) throw new Error("no key");
    fetching ??= listVoices({ apiBase: API_BASE, apiKey, model: MODEL }, http, await version()).finally(() => {
      fetching = null;
    });
    voices = await fetching;
    return voices;
  };

  let fallback: Promise<StoredVoice> | null = null;
  const currentVoice = async (): Promise<StoredVoice> => {
    const stored = storedVoice(await $.store.get("voice"));
    if (stored) return stored;
    fallback ??= (async () => {
      const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>);
      const list = await catalogue().catch(() => null);
      return chooseVoice(null, list, (settings as { language?: unknown }).language);
    })();
    return fallback;
  };

  const floor = new Floor(
    { get: (key) => $.store.get(key), set: (key, value) => $.store.set(key, value) },
    session,
    () => $.clock.now(),
  );

  let timers: { cancel(): void }[] | null = null;
  const stopTimers = () => {
    for (const t of timers ?? []) t.cancel();
    timers = null;
  };
  const beat = async () => {
    if (await floor.lost()) {
      stopTimers();
      player.preempt();
      return;
    }
    await floor.heartbeat();
  };
  const syncTimers = () => {
    const want = timersWanted(player.view().state);
    if (want && !timers) {
      timers = [
        $.clock.every(100, () => {
          void player.tick().then(() => $.ui.invalidate("ui.render"));
        }),
        $.clock.every(HEARTBEAT_MS, () => {
          beat().catch(() => {});
        }),
      ];
    } else if (!want && timers) {
      stopTimers();
    }
  };

  const report = (err: unknown) => {
    const text = errorText(err);
    if (isRefusal(err)) {
      enabled = false;
      picking = false;
      notice = text;
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
      return renderParagraph(text, cfg, cache, (input, c) => synthesize(input, c, http, sleep, v));
    },
    play: (bytes, signal) => $.audio.play({ base64: toBase64(bytes), mime: "audio/mpeg" }, { signal }),
    now: () => $.clock.now(),
    onChange: () => {
      syncTimers();
      $.ui.invalidate("ui.render");
    },
    onError: report,
  });

  const press = async (action: "toggle" | "full") => {
    if (claimsFloor(player.view().state, action, player.hasLatest)) await floor.claim();
    if (action === "toggle") await player.toggle();
    else await player.playFull();
  };
  const actions: BandActions = {
    toggle: () => void press("toggle").catch(report),
    stop: () => player.stop(),
    full: () => void press("full").catch(report),
  };

  return {
    player,
    floor,
    actions,
    catalogue,
    currentVoice,
    version,
    http,
    condense: (text) => condenseReply(text, { run, home, platform }),
    report,
    stopTimers,
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
    off = loopGuard(await $.env.get("READBACK_HOOK"), e.isInteractive);
    if (off) return result;
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
    enabled = (await $.store.get("enabled")) === true && apiKey !== null;
    const home = homeFrom(await $.env.get("HOME"), await $.env.get("USERPROFILE"));
    const platform = platformFrom(await $.env.get("OS"));
    // A second start in this module (/clear gives a new session id): the old
    // player's timers and floor claim must not outlive it.
    const old = app;
    app = null;
    voices = null;
    await old?.close();
    app = build($, apiKey, await $.session.id(), home, platform);
    $.ui.invalidate("ui.render");
    return result;
  });

  on("turn.complete", async ($, e, next) => {
    if (off || !app || !enabled) return next(e);
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
    if (off || !app) return Promise.resolve({});
    const a = app;
    const plan = readbackCommand(e.args, apiKey, enabled);
    const answer = async (): Promise<{ text: string }> => {
      switch (plan.kind) {
        case "text":
          return { text: plan.text };
        case "off":
          enabled = false;
          picking = false;
          await $.store.set("enabled", false);
          a.player.stop();
          a.stopTimers();
          await a.floor.release().catch(() => {});
          $.ui.invalidate("ui.render");
          return { text: OFF };
        case "on": {
          const check = await checkKey(plan.key, { apiBase: API_BASE, model: MODEL }, a.http, await a.version());
          if (!check.ok) return { text: keyCheckText(check) };
          voices = check.voices;
          enabled = true;
          notice = null;
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
          pickerVoice = (await a.currentVoice()).id;
          picking = true;
          $.ui.invalidate("ui.render");
          return { text: PICK };
        }
      }
    };
    return answer().catch((err: unknown) => ({ text: errorText(err) }));
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (off || !app) return next(e);
    const mode = bandMode({ hasSurvey: e.props.hasSurvey, enabled, notice, picking });
    if (mode === "pass") return next(e);
    const els = $.ui.resolve(e) as unknown as Els;
    if (mode === "notice") return noticeBand(notice!, els) as ReturnType<typeof next>;
    if (mode === "picker" && voices) {
      const list = voices;
      const close = () => {
        picking = false;
        $.ui.invalidate("ui.render");
      };
      return voicePicker(
        list,
        pickerVoice,
        els,
        (id) => {
          close();
          $.store.set("voice", pickedVoice(list, id)).catch(app!.report);
        },
        close,
      ) as ReturnType<typeof next>;
    }
    return band(app.player.view(), els, app.actions, notice) as ReturnType<typeof next>;
  });

  on("session.end", async ($, e, next) => {
    if (!off && app) {
      app.player.stop();
      app.stopTimers();
      await app.floor.release().catch(() => {});
    }
    return next(e);
  });
};
