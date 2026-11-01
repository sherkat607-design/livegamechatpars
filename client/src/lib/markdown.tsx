import { useState, type ReactNode } from 'react';

export interface MarkdownContext {
  /** Name to show for a user mention. */
  userName: (id: number) => string | null;
  role: (id: number) => { name: string; color: string | null } | null;
  channelName: (id: number) => string | null;
  /** Highlight mentions that point at me. */
  isMe?: (userId: number) => boolean;
  onUser?: (userId: number, el: HTMLElement) => void;
  onChannel?: (channelId: number) => void;
  /** Smaller rendering (reply previews): no block elements. */
  inline?: boolean;
}

type Rule = {
  name: string;
  re: RegExp;
  render: (m: RegExpExecArray, ctx: MarkdownContext, depth: number, key: string) => ReactNode;
};

const URL_RE = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?،؛]/;

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="spoiler px-0.5"
      data-open={open}
      role="button"
      tabIndex={0}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(true)}
    >
      <span>{children}</span>
    </span>
  );
}

const mentionClass = 'rounded px-0.5 font-medium bg-accent-soft text-accent hover:underline cursor-pointer';

const RULES: Rule[] = [
  {
    name: 'escape',
    re: /\\([*_~`|\\<>#@[\]()-])/,
    render: (m) => m[1],
  },
  {
    name: 'code',
    re: /`([^`\n]+)`/,
    render: (m, _c, _d, key) => (
      <code key={key} dir="auto" className="rounded bg-bg-0/60 px-1 py-0.5 font-mono text-[0.85em]">
        {m[1]}
      </code>
    ),
  },
  {
    name: 'emoji',
    re: /<(a?):([a-zA-Z0-9_]{2,32}):(\d{1,10})>/,
    render: (m, _c, _d, key) => <CustomEmojiTag key={key} id={Number(m[3])} name={m[2]} />,
  },
  {
    name: 'userMention',
    re: /<@!?(\d{1,10})>/,
    render: (m, ctx, _d, key) => {
      const id = Number(m[1]);
      const name = ctx.userName(id);
      return (
        <span
          key={key}
          role="button"
          tabIndex={0}
          className={mentionClass + (ctx.isMe?.(id) ? ' bg-saffron/20 text-saffron' : '')}
          onClick={(e) => ctx.onUser?.(id, e.currentTarget)}
        >
          @{name ?? '…'}
        </span>
      );
    },
  },
  {
    name: 'roleMention',
    re: /<@&(\d{1,10})>/,
    render: (m, ctx, _d, key) => {
      const role = ctx.role(Number(m[1]));
      return (
        <span
          key={key}
          className="rounded px-0.5 font-medium"
          style={role?.color ? { color: role.color, background: `${role.color}22` } : undefined}
        >
          @{role?.name ?? '…'}
        </span>
      );
    },
  },
  {
    name: 'channelMention',
    re: /<#(\d{1,10})>/,
    render: (m, ctx, _d, key) => (
      <span key={key} role="link" tabIndex={0} className={mentionClass} onClick={() => ctx.onChannel?.(Number(m[1]))}>
        #{ctx.channelName(Number(m[1])) ?? '…'}
      </span>
    ),
  },
  {
    name: 'everyone',
    re: /@(everyone|here)\b/,
    render: (m, _c, _d, key) => (
      <span key={key} className="rounded bg-saffron/15 px-0.5 font-medium text-saffron">
        @{m[1]}
      </span>
    ),
  },
  {
    name: 'maskedLink',
    re: /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/,
    render: (m, ctx, depth, key) => (
      <a key={key} href={m[2]} target="_blank" rel="noreferrer noopener" title={m[2]} className="text-accent hover:underline">
        {parseInline(m[1], ctx, depth + 1)}
      </a>
    ),
  },
  {
    name: 'url',
    re: URL_RE,
    render: (m, _c, _d, key) => (
      <a key={key} href={m[0]} target="_blank" rel="noreferrer noopener" dir="ltr" className="text-accent hover:underline">
        {m[0]}
      </a>
    ),
  },
  {
    name: 'spoiler',
    re: /\|\|([\s\S]+?)\|\|/,
    render: (m, ctx, depth, key) => <Spoiler key={key}>{parseInline(m[1], ctx, depth + 1)}</Spoiler>,
  },
  {
    name: 'bold',
    re: /\*\*([\s\S]+?)\*\*/,
    render: (m, ctx, depth, key) => (
      <strong key={key} className="font-bold">
        {parseInline(m[1], ctx, depth + 1)}
      </strong>
    ),
  },
  {
    name: 'underline',
    re: /__([\s\S]+?)__/,
    render: (m, ctx, depth, key) => (
      <u key={key} className="underline-offset-4">
        {parseInline(m[1], ctx, depth + 1)}
      </u>
    ),
  },
  {
    name: 'italic',
    re: /\*([^*\n]+?)\*|\b_([^_\n]+?)_\b/,
    render: (m, ctx, depth, key) => <em key={key}>{parseInline(m[1] ?? m[2], ctx, depth + 1)}</em>,
  },
  {
    name: 'strike',
    re: /~~([\s\S]+?)~~/,
    render: (m, ctx, depth, key) => (
      <s key={key} className="opacity-80">
        {parseInline(m[1], ctx, depth + 1)}
      </s>
    ),
  },
];

/** Parse inline formatting into React nodes. Text is always rendered as text, never as HTML. */
export function parseInline(text: string, ctx: MarkdownContext, depth = 0): ReactNode[] {
  if (depth > 8 || !text) return [text];
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest.length) {
    let best: { rule: Rule; m: RegExpExecArray } | null = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { rule, m };
      if (best?.m.index === 0) break;
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m, ctx, depth, `${depth}-${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

// Custom emoji images: resolved through a registry filled from the store (url by id).
const emojiUrls = new Map<number, string>();
export function registerEmojiUrls(list: { id: number; url: string }[]) {
  for (const e of list) emojiUrls.set(e.id, e.url);
}

function CustomEmojiTag({ id, name, big }: { id: number; name: string; big?: boolean }) {
  const url = emojiUrls.get(id);
  if (!url) return <span title={`:${name}:`}>:{name}:</span>;
  return (
    <img
      src={url}
      alt={`:${name}:`}
      title={`:${name}:`}
      className={big ? 'inline-block h-12 w-12 object-contain align-bottom' : 'inline-block h-[1.4em] w-[1.4em] object-contain align-[-0.3em]'}
      draggable={false}
    />
  );
}

const EMOJI_ONLY = /^(?:\s|<a?:[a-zA-Z0-9_]{2,32}:\d{1,10}>|\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u;

function jumbo(text: string): ReactNode | null {
  if (!EMOJI_ONLY.test(text) || /^[\d#*\s]+$/.test(text)) return null;
  const parts = text.match(/<a?:[a-zA-Z0-9_]{2,32}:\d{1,10}>|\S/gu) ?? [];
  if (parts.length > 27) return null;
  const nodes: ReactNode[] = [];
  let i = 0;
  for (const m of text.matchAll(/<(a?):([a-zA-Z0-9_]{2,32}):(\d{1,10})>|[^<\s]+/gu)) {
    if (m[3]) nodes.push(<CustomEmojiTag key={i++} id={Number(m[3])} name={m[2]} big />);
    else nodes.push(<span key={i++}>{m[0]}</span>);
  }
  return <div className="flex flex-wrap items-end gap-1 text-[44px] leading-tight">{nodes}</div>;
}

/** Render a full message body (code blocks, quotes, headings, lists, inline formatting). */
export function renderMarkdown(text: string, ctx: MarkdownContext): ReactNode {
  if (ctx.inline) return parseInline(text.replace(/\n+/g, ' '), ctx);
  const big = jumbo(text.trim());
  if (big) return big;

  const blocks: ReactNode[] = [];
  const codeRe = /```(?:([\w+#.-]{1,20})\n)?([\s\S]*?)```/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(codeRe)) {
    if (m.index! > last) blocks.push(...renderLines(text.slice(last, m.index), ctx, `b${k++}`));
    blocks.push(<CodeBlock key={`c${k++}`} code={m[2].replace(/^\n/, '').replace(/\n$/, '')} lang={m[1]} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) blocks.push(...renderLines(text.slice(last), ctx, `b${k++}`));
  return blocks;
}

function renderLines(chunk: string, ctx: MarkdownContext, keyBase: string): ReactNode[] {
  const lines = chunk.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `${keyBase}-${k++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('>>> ')) {
      const rest = [line.slice(4), ...lines.slice(i + 1)].join('\n');
      out.push(
        <blockquote key={key()} className="my-0.5 border-s-4 border-line ps-3 text-text-2">
          {withBreaks(rest, ctx)}
        </blockquote>,
      );
      break;
    }
    if (line.startsWith('> ') || line === '>') {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoted.push(lines[i].slice(2));
        i++;
      }
      out.push(
        <blockquote key={key()} className="my-0.5 border-s-4 border-line ps-3 text-text-2">
          {withBreaks(quoted.join('\n'), ctx)}
        </blockquote>,
      );
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      const size = heading[1].length === 1 ? 'text-xl' : heading[1].length === 2 ? 'text-lg' : 'text-base';
      out.push(
        <div key={key()} className={`${size} mt-1 font-bold`}>
          {parseInline(heading[2], ctx)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*] /, ''));
        i++;
      }
      out.push(
        <ul key={key()} className="my-0.5 list-disc ps-6">
          {items.map((it, j) => (
            <li key={j}>{parseInline(it, ctx)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    // Plain paragraph lines until the next special line.
    const para: string[] = [];
    while (
      i < lines.length &&
      !lines[i].startsWith('> ') &&
      lines[i] !== '>' &&
      !lines[i].startsWith('>>> ') &&
      !/^(#{1,3}) .+$/.test(lines[i]) &&
      !/^\s*[-*] /.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push(<span key={key()}>{withBreaks(para.join('\n'), ctx)}</span>);
  }
  return out;
}

function withBreaks(text: string, ctx: MarkdownContext): ReactNode[] {
  const parts = text.split('\n');
  return parts.flatMap((p, i) => (i === 0 ? parseInline(p, ctx) : [<br key={`br${i}`} />, ...parseInline(p, ctx)]));
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-1 max-w-full">
      <pre dir="ltr" className="overflow-x-auto rounded-lg border border-line bg-bg-0/70 p-3 text-start font-mono text-[13px] leading-relaxed">
        {lang && <div className="mb-1 text-[11px] text-text-3">{lang}</div>}
        <code>{code}</code>
      </pre>
      <button
        type="button"
        className="absolute end-2 top-2 rounded bg-bg-3 px-2 py-0.5 text-xs text-text-2 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
        onClick={() => {
          navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </div>
  );
}

/** Plain-text preview of a message (notifications, reply bars). */
export function plainText(text: string, ctx: Pick<MarkdownContext, 'userName' | 'role' | 'channelName'>): string {
  return text
    .replace(/<@!?(\d+)>/g, (_, id) => `@${ctx.userName(Number(id)) ?? '…'}`)
    .replace(/<@&(\d+)>/g, (_, id) => `@${ctx.role(Number(id))?.name ?? '…'}`)
    .replace(/<#(\d+)>/g, (_, id) => `#${ctx.channelName(Number(id)) ?? '…'}`)
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/\|\|[\s\S]*?\|\|/g, '▒▒▒')
    .replace(/[*_~`]/g, '')
    .slice(0, 200);
}
