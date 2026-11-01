// Desktop notifications, short sounds generated with Web Audio (no audio files needed),
// and the unread count in the tab title.

const PREFS_KEY = 'lgcp.notify';

export interface NotifyPrefs {
  desktop: boolean;
  sounds: boolean;
}

export function getNotifyPrefs(): NotifyPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { desktop: raw.desktop !== false, sounds: raw.sounds !== false };
  } catch {
    return { desktop: true, sounds: true };
  }
}

export function setNotifyPrefs(p: NotifyPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freqs: number[], duration = 0.12, gap = 0.04, volume = 0.08) {
  const ac = audio();
  if (!ac) return;
  let t = ac.currentTime;
  for (const f of freqs) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    t += duration + gap;
  }
}

export const sounds = {
  message: () => getNotifyPrefs().sounds && tone([880, 1320], 0.09),
  join: () => getNotifyPrefs().sounds && tone([523, 784], 0.1),
  leave: () => getNotifyPrefs().sounds && tone([784, 523], 0.1),
  mute: () => getNotifyPrefs().sounds && tone([440], 0.06),
  unmute: () => getNotifyPrefs().sounds && tone([660], 0.06),
};

let ringTimer: number | null = null;
export function startRinging() {
  stopRinging();
  const ring = () => getNotifyPrefs().sounds && tone([659, 784, 988], 0.16, 0.06, 0.1);
  ring();
  ringTimer = window.setInterval(ring, 2200);
}
export function stopRinging() {
  if (ringTimer !== null) window.clearInterval(ringTimer);
  ringTimer = null;
}

export async function requestDesktopPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function desktopNotify(title: string, body: string, icon: string | null, onClick: () => void, tag?: string) {
  if (!getNotifyPrefs().desktop || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: icon ?? '/favicon.svg', tag, silent: true });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

export function setTitleBadge(count: number, base: string) {
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}
