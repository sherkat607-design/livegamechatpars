import { useSyncExternalStore } from 'react';
import { en } from './en';
import { fa } from './fa';

export type Lang = 'fa' | 'en';
export type Dict = Record<string, string>;
export type TParams = Record<string, string | number>;

const dicts: Record<Lang, Dict> = { fa, en };
const STORAGE_KEY = 'lgcp.lang';

/** Persian is the default for everyone; English is one click away on the sign-in page and in settings. */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fa' || saved === 'en') return saved;
  } catch {
    // storage unavailable
  }
  return 'fa';
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();

function apply(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.title = lang === 'fa' ? 'لایو گیم چت پارس' : 'LiveGameChat Pars';
}
apply(current);

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  apply(lang);
  for (const l of listeners) l();
}

const faDigits = new Intl.NumberFormat('fa-IR', { useGrouping: false });
const enDigits = new Intl.NumberFormat('en-US', { useGrouping: false });

/** Format a number with the digits of the current language. */
export function num(n: number, lang: Lang = current): string {
  return (lang === 'fa' ? faDigits : enDigits).format(n);
}

/** Translate a key. `{name}` placeholders are filled from params; numbers use local digits. */
export function t(key: string, params?: TParams, lang: Lang = current): string {
  const dict = dicts[lang];
  let text = dict[key];
  if (params && typeof params.count === 'number' && params.count === 1 && dict[`${key}_one`]) text = dict[`${key}_one`];
  if (text === undefined) text = dicts.en[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) return `{${name}}`;
    return typeof v === 'number' ? num(v, lang) : v;
  });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-renders the component when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

export function useT() {
  const lang = useLang();
  return (key: string, params?: TParams) => t(key, params, lang);
}

/** Translate an API error code, falling back to the server's message. */
export function errorText(err: unknown): string {
  const e = err as { code?: string; message?: string; data?: { retryAfter?: number } };
  if (e?.code) {
    const key = `error.${e.code}`;
    if (dicts[current][key]) return t(key, { seconds: e.data?.retryAfter ?? 0 });
  }
  return t('error.generic');
}
