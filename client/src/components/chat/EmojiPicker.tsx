import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomEmoji } from '@shared/types';
import { useT } from '../../i18n';
import { loadEmojis, recentEmojis, searchEmojis, type EmojiData } from '../../lib/emoji';
import { useStore } from '../../store';
import { cx, Spinner } from '../ui';

export interface PickedEmoji {
  /** What to send as a reaction: unicode, or name:id for custom emojis. */
  reaction: string;
  /** What to insert into a message. */
  insert: string;
}

const GROUP_ICONS = ['😀', '👋', '', '🐻', '🍔', '✈️', '🎮', '💡', '❤️', '🏳️'];

export function EmojiPicker({ serverId, onPick }: { serverId: number | null; onPick: (e: PickedEmoji) => void }) {
  const t = useT();
  const [data, setData] = useState<EmojiData | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<number | 'recent' | 'custom'>('recent');
  const servers = useStore((s) => s.servers);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadEmojis().then(setData);
    input.current?.focus();
  }, []);

  const custom: CustomEmoji[] = useMemo(() => {
    const own = serverId ? (servers[serverId]?.emojis ?? []) : [];
    const others = Object.values(servers).flatMap((s) => (s.server.id === serverId ? [] : s.emojis));
    return [...own, ...others];
  }, [servers, serverId]);

  const recent = recentEmojis();
  const results = useMemo(() => {
    if (!data) return [];
    if (query) return searchEmojis(data, query, 120);
    if (group === 'recent' || group === 'custom') return [];
    return data.list.filter((e) => e.group === group);
  }, [data, query, group]);
  const customShown = query ? custom.filter((e) => e.name.toLowerCase().includes(query.toLowerCase())) : group === 'custom' ? custom : [];

  return (
    <div className="flex h-[380px] w-[340px] max-w-[92vw] flex-col">
      <div className="p-2">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('emoji.search')}
          aria-label={t('emoji.search')}
          dir="ltr"
          className="h-9 w-full rounded-lg border border-line bg-bg-0/60 px-3 text-[14px] placeholder:text-text-3 focus:border-accent focus:outline-none"
        />
      </div>
      {!query && (
        <div role="tablist" className="flex gap-0.5 overflow-x-auto px-2 pb-1">
          <Tab active={group === 'recent'} label={t('emoji.recent')} onClick={() => setGroup('recent')}>
            🕘
          </Tab>
          {custom.length > 0 && (
            <Tab active={group === 'custom'} label={t('emoji.custom')} onClick={() => setGroup('custom')}>
              ✦
            </Tab>
          )}
          {GROUP_ICONS.map((icon, g) =>
            icon ? (
              <Tab key={g} active={group === g} label={t(`emoji.group.${g}`)} onClick={() => setGroup(g)}>
                {icon}
              </Tab>
            ) : null,
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!data && (
          <div className="flex justify-center py-8 text-text-3">
            <Spinner />
          </div>
        )}
        {data && !query && group === 'recent' && (
          <Grid>
            {(recent.length ? recent : ['👍', '😂', '🔥', '🎮', '❤️', '😮', '🙏', '💯', '😎', '🏆', '👀', '🤝']).map((e) => (
              <Cell key={e} label={e} onClick={() => onPick(asPicked(e, custom))}>
                {renderPicked(e, custom)}
              </Cell>
            ))}
          </Grid>
        )}
        {customShown.length > 0 && (
          <>
            {query && <h4 className="px-1 pt-1 text-[12px] text-text-3">{t('emoji.custom')}</h4>}
            <Grid>
              {customShown.map((e) => (
                <Cell key={e.id} label={`:${e.name}:`} onClick={() => onPick({ reaction: `${e.name}:${e.id}`, insert: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` })}>
                  <img src={e.url} alt="" className="h-7 w-7 object-contain" />
                </Cell>
              ))}
            </Grid>
          </>
        )}
        <Grid>
          {results.map((e) => (
            <Cell key={e.unicode} label={e.shortcodes[0] ? `:${e.shortcodes[0]}:` : e.label} onClick={() => onPick({ reaction: e.unicode, insert: e.unicode })}>
              {e.unicode}
            </Cell>
          ))}
        </Grid>
        {data && query && results.length === 0 && customShown.length === 0 && <p className="py-6 text-center text-[13px] text-text-3">{t('emoji.none')}</p>}
      </div>
    </div>
  );
}

function asPicked(e: string, custom: CustomEmoji[]): PickedEmoji {
  const m = /^([a-zA-Z0-9_]{2,32}):(\d+)$/.exec(e);
  if (m) {
    const c = custom.find((x) => x.id === Number(m[2]));
    return { reaction: e, insert: `<${c?.animated ? 'a' : ''}:${m[1]}:${m[2]}>` };
  }
  return { reaction: e, insert: e };
}

function renderPicked(e: string, custom: CustomEmoji[]) {
  const m = /^([a-zA-Z0-9_]{2,32}):(\d+)$/.exec(e);
  if (m) {
    const c = custom.find((x) => x.id === Number(m[2]));
    return c ? <img src={c.url} alt="" className="h-7 w-7 object-contain" /> : `:${m[1]}:`;
  }
  return e;
}

function Tab({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[17px]', active ? 'bg-accent-soft' : 'hover:bg-hover')}
    >
      {children}
    </button>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-8 gap-0.5">{children}</div>;
}

function Cell({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="flex h-9 w-9 items-center justify-center rounded-md text-[22px] hover:bg-hover">
      {children}
    </button>
  );
}
