import { getLang, num, t } from '../i18n';

function locale() {
  return getLang() === 'fa' ? 'fa-IR' : 'en-US';
}

/** "Today at 14:05", "Yesterday at …" or a full date. */
export function messageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return t('time.todayAt', { time });
  if (diffDays === 1) return t('time.yesterdayAt', { time });
  return `${d.toLocaleDateString(locale(), { year: 'numeric', month: 'numeric', day: 'numeric' })} ${time}`;
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { dateStyle: 'full', timeStyle: 'short' });
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

export function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return t('size.bytes', { n: bytes });
  if (bytes < 1024 * 1024) return t('size.kb', { n: Math.round(bytes / 102.4) / 10 });
  return t('size.mb', { n: Math.round(bytes / (1024 * 102.4)) / 10 });
}

/** "in 3 hours" / "2 days ago" style relative time. */
export function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

export function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' });
}

export { num };
