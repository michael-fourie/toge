import { type MapAction, type SavedMap, applyMapAction, cleanSaved } from '../shared/custommap.ts';
import type { KV } from '../../server/accountStore.ts';

/**
 * Accounts' custom maps (the map builder), in the Accounts DO: `mp:<user>` is the list, newest first. The rules
 * (how many, what a valid map is) are custommap.ts `applyMapAction`, the same ones a guest's browser runs.
 */
export class MapStore {
  constructor(private kv: KV) {}

  async list(user: string): Promise<SavedMap[]> {
    const v = await this.kv.get<unknown>(`mp:${user.toLowerCase()}`);
    return Array.isArray(v) ? v.map(cleanSaved).filter((s): s is SavedMap => !!s) : [];
  }

  async act(user: string, action: MapAction, now: number): Promise<{ ok: true; maps: SavedMap[] } | { ok: false; error: string }> {
    const r = applyMapAction(await this.list(user), action, now);
    if (!r.ok) return r;
    await this.kv.put(`mp:${user.toLowerCase()}`, r.list);
    return { ok: true, maps: r.list };
  }
}
