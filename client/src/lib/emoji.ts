export interface EmojiItem {
  unicode: string;
  label: string;
  group: number;
  order: number;
  shortcodes: string[];
  tags: string[];
}

export interface EmojiData {
  list: EmojiItem[];
  byShortcode: Map<string, string>;
}

let cache: Promise<EmojiData> | null = null;

/** Loaded on first use so the main bundle stays small. */
export function loadEmojis(): Promise<EmojiData> {
  cache ??= Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/shortcodes/github.json'),
  ]).then(([compact, shortcodes]) => {
    const codes = (shortcodes.default ?? shortcodes) as Record<string, string | string[]>;
    const raw = (compact.default ?? compact) as {
      unicode: string;
      label: string;
      group?: number;
      order?: number;
      hexcode: string;
      tags?: string[];
    }[];
    const list: EmojiItem[] = [];
    const byShortcode = new Map<string, string>();
    for (const e of raw) {
      if (e.group === undefined || e.group === 2) continue; // skip components (skin tone swatches)
      const sc = codes[e.hexcode];
      const shortcodesFor = sc ? (Array.isArray(sc) ? sc : [sc]) : [];
      for (const s of shortcodesFor) byShortcode.set(s, e.unicode);
      list.push({ unicode: e.unicode, label: e.label, group: e.group, order: e.order ?? 0, shortcodes: shortcodesFor, tags: e.tags ?? [] });
    }
    list.sort((a, b) => a.order - b.order);
    return { list, byShortcode };
  });
  return cache;
}

export function searchEmojis(data: EmojiData, query: string, limit = 60): EmojiItem[] {
  const q = query.trim().toLowerCase().replace(/^:/, '');
  if (!q) return data.list.slice(0, limit);
  const starts: EmojiItem[] = [];
  const contains: EmojiItem[] = [];
  for (const e of data.list) {
    if (e.shortcodes.some((s) => s.startsWith(q)) || e.label.startsWith(q)) starts.push(e);
    else if (e.label.includes(q) || e.tags.some((t) => t.startsWith(q)) || e.shortcodes.some((s) => s.includes(q))) contains.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

const RECENT_KEY = 'lgcp.recentEmojis';

export function recentEmojis(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji: string) {
  try {
    const next = [emoji, ...recentEmojis().filter((e) => e !== emoji)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/** The quick reactions shown first, chosen for gaming chats. */
export const QUICK_REACTIONS = ['👍', '😂', '🔥', '🎮', '❤️', '😮', '🙏', '💯'];
