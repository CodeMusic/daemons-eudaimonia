// Each lane's daemon kept in Redmine (the user, 2026-11-23: "if I change it in redmine it reflects on the dashboard"): a
// lane's Redmine user carries a Daemon field (a list of every daemon's name) and a Daemon sprite field (its picture, written
// from Daemon, never by hand). Redmine is the source: every minute each lane's Daemon is read with the lane's own key and
// its agent account here follows it. The admin's picker on THE DASHBOARD writes back to Redmine, so the two agree.
// A lane's own key is enough for both (GET /users/current.json, PUT /my/account.json): no admin key is needed.
import type { Accounts } from "./accounts.ts";
import type { Avatars } from "./avatars.ts";

type Fetch = typeof fetch;
type Field = { id: number; name: string; value?: string | null };
export type LaneDaemonOptions = { url: string; keys: Record<string, string>; accounts: Accounts; avatars: Avatars;
  spriteBase: string; log?: (l: string) => void; fetch?: Fetch };

export const DAEMON_FIELD = "Daemon", SPRITE_FIELD = "Daemon sprite";

/** Every lane key in a Redmine env file: REDMINE_KEY_PI_ZERO -> pi-zero. REDMINE_KEY_USER is a person's, not a lane's. */
export function laneKeysFrom(env: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of env.split("\n")) {
    const m = /^\s*REDMINE_KEY_([A-Z0-9_]+)\s*=\s*(\S+)\s*$/.exec(line);
    if (m && m[1] !== "USER") out[m[1].toLowerCase().replace(/_/g, "-")] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export class LaneDaemons {
  private readonly o: LaneDaemonOptions;
  private readonly fetch: Fetch;
  private readonly fields = new Map<string, number>();   // field name -> id, learned from the first read
  constructor(o: LaneDaemonOptions) { this.o = o; this.fetch = o.fetch ?? fetch; }

  get lanes() { return Object.keys(this.o.keys); }
  private say(l: string) { this.o.log?.(l); }
  spriteText(id: number, name: string) { return `![${name}](${this.o.spriteBase.replace(/\/$/, "")}/sprite/${id}.png)`; }

  private async me(key: string): Promise<Field[]> {
    const r = await this.fetch(`${this.o.url}/users/current.json`, { headers: { "X-Redmine-API-Key": key, Accept: "application/json" },
                                                                    signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Redmine answered ${r.status}`);
    const fields: Field[] = (await r.json()).user?.custom_fields ?? [];
    for (const f of fields) this.fields.set(f.name, f.id);
    return fields;
  }

  private async write(key: string, values: Record<string, string>) {
    const custom_fields = Object.entries(values).flatMap(([name, value]) => {
      const id = this.fields.get(name);
      return id == null ? [] : [{ id, value }];
    });
    if (!custom_fields.length) return;
    const r = await this.fetch(`${this.o.url}/my/account.json`, { method: "PUT", body: JSON.stringify({ user: { custom_fields } }),
      headers: { "X-Redmine-API-Key": key, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Redmine refused the change (${r.status})`);
  }

  /** Redmine -> here, for every lane: what changed, e.g. ["hub: ROVERBYTE"]. A lane Redmine cannot be asked about is left. */
  async pull(): Promise<string[]> {
    const changed: string[] = [];
    for (const [lane, key] of Object.entries(this.o.keys)) {
      try {
        const fields = await this.me(key);
        const name = fields.find((f) => f.name === DAEMON_FIELD)?.value?.trim();
        if (!name) continue;
        const d = this.o.avatars.byName(name);
        if (!d) { this.say(`${lane}'s Daemon in Redmine is ${name}, which is no daemon here`); continue; }
        if ((await this.o.accounts.laneDaemon(lane, d.id)) !== "same") changed.push(`${lane}: ${d.name}`);
        const want = this.spriteText(d.id, d.name);
        if (fields.find((f) => f.name === SPRITE_FIELD)?.value !== want) await this.write(key, { [SPRITE_FIELD]: want });
      } catch (e) {
        this.say(`${lane}'s daemon can't be read from Redmine (${(e as Error).message})`);
      }
    }
    return changed;
  }

  /** Here -> Redmine: the admin chose a lane's daemon on THE DASHBOARD. False when this is no lane of Redmine's. */
  async push(lane: string, id: number): Promise<boolean> {
    const key = this.o.keys[lane], d = this.o.avatars.daemon(id);
    if (!key || !d) return false;
    if (!this.fields.size) await this.me(key);
    await this.write(key, { [DAEMON_FIELD]: d.name, [SPRITE_FIELD]: this.spriteText(d.id, d.name) });
    return true;
  }
}
