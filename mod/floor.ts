/** One speaker across sessions: a claim record in the shared store. */
export type Store = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

export const FLOOR_KEY = "floor";
export const STALE_MS = 3000;
export const HEARTBEAT_MS = 1000;

type Record = { session: string; at: number };

function asRecord(v: unknown): Record | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as { session?: unknown; at?: unknown };
  return typeof r.session === "string" && typeof r.at === "number" ? { session: r.session, at: r.at } : null;
}

export class Floor {
  constructor(
    private readonly store: Store,
    private readonly session: string,
    private readonly now: () => Promise<number>,
  ) {}

  private async current(): Promise<Record | null> {
    return asRecord(await this.store.get(FLOOR_KEY));
  }

  /** Take the floor, whoever held it. */
  async claim(): Promise<void> {
    await this.store.set(FLOOR_KEY, { session: this.session, at: await this.now() });
  }

  /** Clear our own claim only. */
  async release(): Promise<void> {
    const rec = await this.current();
    if (rec?.session !== this.session) return;
    await this.store.set(FLOOR_KEY, null);
  }

  /**
   * The once-a-second check, in one read: "lost" when another session holds
   * a fresh claim, "held" when the claim is ours (and is refreshed), "free"
   * otherwise. Never takes the floor back.
   */
  async beat(): Promise<"lost" | "held" | "free"> {
    const rec = await this.current();
    if (!rec) return "free";
    const now = await this.now();
    if (rec.session !== this.session) return now - rec.at < STALE_MS ? "lost" : "free";
    await this.store.set(FLOOR_KEY, { session: this.session, at: now });
    return "held";
  }
}
