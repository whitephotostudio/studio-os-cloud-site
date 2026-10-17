import { parseCollageSelection, type CollageSelection } from "./collage-selection";
type CollageCartItem = { slots: Array<{ collage?: CollageSelection }> };
const key = (owner: string, lane: string) => `studio-os-collage-cart:v1:${owner}:${lane}`;

/** Event carts use cookie-bound lane identity, never PINs/emails or source URLs as scope. */
export function saveCollageCart<T extends CollageCartItem>(storage: Storage, owner: string, lane: string, items: T[]) {
  if (!owner || !lane) return;
  if (!items.some(item => item.slots.some(slot => slot.collage))) { storage.removeItem(key(owner, lane)); return; }
  const cleaned = items.map(item => ({ ...item, slots: item.slots.map(slot => ({ ...slot, ...(slot.collage ? { collage: parseCollageSelection(slot.collage) } : {}) })) }));
  storage.setItem(key(owner, lane), JSON.stringify({ version: 1, owner, lane, items: cleaned }));
}
export function loadCollageCart<T extends CollageCartItem>(storage: Storage, owner: string, lane: string): T[] {
  const raw = storage.getItem(key(owner, lane));
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (value?.version !== 1 || value.owner !== owner || value.lane !== lane || !Array.isArray(value.items) || value.items.length > 100) throw Error("This collage basket could not be restored. Reopen the gallery before continuing.");
  return value.items.map((item: T) => {
    if (!Array.isArray(item.slots) || item.slots.length > 100) throw Error("Invalid saved collage basket.");
    return { ...item, slots: item.slots.map(slot => ({ ...slot, ...(slot.collage ? { collage: parseCollageSelection(slot.collage) } : {}) })) };
  });
}
