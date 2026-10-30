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

  /** Refresh our claim; never takes the floor back. */
  async heartbeat(): Promise<void> {
    const rec = await this.current();
    if (rec?.session !== this.session) return;
    await this.store.set(FLOOR_KEY, { session: this.session, at: await this.now() });
  }

  /** Clear our own claim only. */
  async release(): Promise<void> {
    const rec = await this.current();
    if (rec?.session !== this.session) return;
    await this.store.set(FLOOR_KEY, null);
  }

  /** Another session holds a fresh claim. */
  async lost(): Promise<boolean> {
    const rec = await this.current();
    if (!rec || rec.session === this.session) return false;
    return (await this.now()) - rec.at < STALE_MS;
  }
}
