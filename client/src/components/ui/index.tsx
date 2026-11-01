import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { create } from 'zustand';
import type { PresenceStatus, PublicUser } from '@shared/types';
import { useT } from '../../i18n';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---------- brand ----------

/** The eight-point star (shamseh) with a play mark: the LiveGameChat Pars logo. */
export function BrandMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path fill="var(--accent)" d="M32 3.7 40.3 12H52v11.7l8.3 8.3-8.3 8.3V52H40.3L32 60.3 23.7 52H12V40.3L3.7 32 12 23.7V12h11.7z" />
      <circle cx="32" cy="32" r="13" fill="var(--bg-0)" />
      <path fill="var(--saffron)" d="M28 25.5v13l11-6.5z" />
    </svg>
  );
}

// ---------- buttons & fields ----------

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; small?: boolean }>(
  function Button({ variant = 'primary', busy, small, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors disabled:opacity-50',
          small ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
          variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent-strong',
          variant === 'secondary' && 'bg-bg-4 text-text-1 hover:bg-line',
          variant === 'danger' && 'bg-danger text-white hover:brightness-110',
          variant === 'ghost' && 'text-text-2 hover:bg-hover hover:text-text-1',
          className,
        )}
        disabled={disabled || busy}
        {...rest}
      >
        {busy ? <Spinner small /> : children}
      </button>
    );
  },
);

export function IconButton({
  label,
  active,
  danger,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-accent-soft text-accent' : danger ? 'text-danger-text hover:bg-danger/15' : 'text-text-2 hover:bg-hover hover:text-text-1',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-4 w-4' : 'h-6 w-6')}
    />
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-text-2">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-[13px] text-danger-text">{error}</p> : hint ? <p className="text-[12px] text-text-3">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-10 w-full rounded-[10px] border border-line bg-bg-0/60 px-3 text-[15px] text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none',
        className,
      )}
      {...rest}
    />
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        'w-full rounded-[10px] border border-line bg-bg-0/60 px-3 py-2 text-[15px] text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none',
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ value, onChange, options, id, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; id?: string; className?: string }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx('h-10 w-full rounded-[10px] border border-line bg-bg-0/60 px-3 text-[15px] text-text-1 focus:border-accent focus:outline-none', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <label htmlFor={id} className="flex-1 cursor-pointer">
        <span className="block text-[15px] text-text-1">{label}</span>
        {description && <span className="block text-[13px] text-text-3">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-bg-4')}
      >
        <span
          className={cx(
            'absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-[inset-inline-start]',
            checked ? 'start-6' : 'start-1',
          )}
        />
      </button>
    </div>
  );
}

// ---------- avatar & status ----------

const AVATAR_HUES = ['#2ec4b6', '#f2b33d', '#e5484d', '#7c8cf8', '#3ccb7f', '#f07fbf', '#58a6ff', '#c58af9'];

function hueFor(id: number) {
  return AVATAR_HUES[Math.abs(id) % AVATAR_HUES.length];
}

export const STATUS_COLOR: Record<PresenceStatus, string> = {
  online: 'var(--accent)',
  idle: 'var(--idle)',
  dnd: 'var(--danger)',
  invisible: 'var(--offline)',
  offline: 'var(--offline)',
};

export function StatusDot({ status, size = 10, ring = 'var(--bg-1)' }: { status: PresenceStatus; size?: number; ring?: string }) {
  const t = useT();
  return (
    <span
      aria-label={t(`status.${status}`)}
      title={t(`status.${status}`)}
      className="absolute bottom-0 end-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: status === 'offline' || status === 'invisible' ? 'transparent' : STATUS_COLOR[status],
        border: status === 'offline' || status === 'invisible' ? `${Math.max(2, size / 4)}px solid var(--offline)` : undefined,
        boxShadow: `0 0 0 ${Math.max(2, size / 4)}px ${ring}`,
      }}
    />
  );
}

export function Avatar({
  user,
  size = 40,
  status,
  speaking,
  ring,
  className,
}: {
  user: Pick<PublicUser, 'id' | 'displayName' | 'avatar'> | null | undefined;
  size?: number;
  status?: PresenceStatus | null;
  speaking?: boolean;
  ring?: string;
  className?: string;
}) {
  const name = user?.displayName ?? '?';
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <span className={cx('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {user?.avatar ? (
        <img src={user.avatar} alt="" className={cx('h-full w-full rounded-full object-cover', speaking && 'speaking')} draggable={false} />
      ) : (
        <span
          className={cx('flex h-full w-full items-center justify-center rounded-full font-bold text-[#0b1626] select-none', speaking && 'speaking')}
          style={{ background: user ? hueFor(user.id) : 'var(--bg-4)', fontSize: size * 0.42 }}
        >
          {initial}
        </span>
      )}
      {status && <StatusDot status={status} size={Math.max(8, Math.round(size * 0.3))} ring={ring} />}
    </span>
  );
}

export function ServerIcon({ name, icon, size = 48, className }: { name: string; icon: string | null; size?: number; className?: string }) {
  if (icon) return <img src={icon} alt="" className={cx('object-cover', className)} style={{ width: size, height: size }} draggable={false} />;
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('');
  return (
    <span className={cx('flex items-center justify-center font-bold select-none', className)} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {letters || '?'}
    </span>
  );
}

// ---------- modal ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  bare,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  bare?: boolean;
  labelledBy?: string;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = panel.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not([data-close])');
    focusable?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        className={cx('pop-in flex max-h-[min(90vh,820px)] w-full flex-col overflow-hidden rounded-2xl bg-bg-2 text-text-1', wide ? 'max-w-3xl' : 'max-w-md')}
        style={{ boxShadow: 'var(--shadow)' }}
      >
        {bare ? (
          children
        ) : (
          <>
            {title && (
              <div className="flex items-start justify-between gap-3 px-5 pt-5">
                <h2 id={titleId} className="font-display text-[22px] text-text-1">
                  {title}
                </h2>
                <IconButton label={t('common.close')} onClick={onClose} data-close>
                  <X size={18} />
                </IconButton>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 bg-bg-1 px-5 py-3">{footer}</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------- anchored popover / menu ----------

export interface Anchor {
  x: number;
  y: number;
  /** Width of the anchor (to align popovers with buttons). */
  w?: number;
  h?: number;
}

export function anchorOf(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function Popover({
  anchor,
  onClose,
  children,
  placement = 'below',
  className,
}: {
  anchor: Anchor | null;
  onClose: () => void;
  children: ReactNode;
  placement?: 'below' | 'above' | 'side' | 'point';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const el = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rtl = document.documentElement.dir === 'rtl';
    let left: number;
    let top: number;
    if (placement === 'point') {
      left = rtl ? anchor.x - el.width : anchor.x;
      top = anchor.y;
    } else if (placement === 'side') {
      left = rtl ? anchor.x - el.width - 8 : anchor.x + (anchor.w ?? 0) + 8;
      if (left < 8 || left + el.width > vw - 8) left = rtl ? anchor.x + (anchor.w ?? 0) + 8 : anchor.x - el.width - 8;
      top = anchor.y;
    } else {
      left = rtl ? anchor.x + (anchor.w ?? 0) - el.width : anchor.x;
      top = placement === 'below' ? anchor.y + (anchor.h ?? 0) + 6 : anchor.y - el.height - 6;
      if (top + el.height > vh - 8 && placement === 'below') top = anchor.y - el.height - 6;
    }
    left = Math.min(Math.max(8, left), vw - el.width - 8);
    top = Math.min(Math.max(8, top), vh - el.height - 8);
    setPos({ left, top });
  }, [anchor, placement]);
  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);
  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      className={cx('pop-in fixed z-[60] rounded-xl border border-line bg-bg-3 text-text-1', className)}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, boxShadow: 'var(--shadow)' }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
  disabled?: boolean;
}

export function Menu({ anchor, onClose, items, placement }: { anchor: Anchor | null; onClose: () => void; items: (MenuItem | 'divider')[]; placement?: 'below' | 'above' | 'side' | 'point' }) {
  const visible = items.filter((i) => i === 'divider' || !i.hidden);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (anchor) list.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [anchor]);
  return (
    <Popover anchor={anchor} onClose={onClose} placement={placement}>
      <div
        ref={list}
        role="menu"
        className="flex min-w-48 flex-col p-1.5"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }}
      >
        {visible.map((item, i) =>
          item === 'divider' ? (
            <div key={i} className="my-1 h-px bg-line" />
          ) : (
            <button
              key={i}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={cx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start text-[14px] disabled:opacity-40',
                item.danger ? 'text-danger-text hover:bg-danger hover:text-white' : 'text-text-2 hover:bg-accent hover:text-accent-ink',
              )}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
            </button>
          ),
        )}
      </div>
    </Popover>
  );
}

// ---------- toasts ----------

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let toastId = 0;

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  window.setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4500);
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return createPortal(
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex flex-col items-center gap-2 px-4">
      {toasts.map((x) => (
        <div
          key={x.id}
          className={cx(
            'pop-in pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-[14px] font-medium',
            x.kind === 'error' ? 'bg-danger text-white' : x.kind === 'success' ? 'bg-accent text-accent-ink' : 'bg-bg-4 text-text-1',
          )}
          style={{ boxShadow: 'var(--shadow)' }}
        >
          {x.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------- confirm dialog ----------

interface ConfirmRequest {
  title: string;
  body?: ReactNode;
  confirmText: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ req: { ...opts, resolve } }));
}

export function ConfirmHost() {
  const req = useConfirm((s) => s.req);
  const t = useT();
  const close = (ok: boolean) => {
    req?.resolve(ok);
    useConfirm.setState({ req: null });
  };
  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      title={req?.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {req?.confirmText}
          </Button>
        </>
      }
    >
      <div className="text-[15px] text-text-2">{req?.body}</div>
    </Modal>
  );
}

/** Small empty-state block with the eight-point star. */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <BrandMark size={72} className="opacity-90" />
      <h3 className="font-display text-[22px] text-text-1">{title}</h3>
      {body && <p className="max-w-sm text-[14px] text-text-3">{body}</p>}
      {action}
    </div>
  );
}
