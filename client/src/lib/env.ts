/**
 * Where the API lives. Empty on the web: the site and the API share an origin and
 * sign-in uses an httpOnly cookie. The Android app is built with VITE_API_ORIGIN
 * (for example https://chat.example.com) and signs in with a bearer token instead.
 */
export const API_ORIGIN = ((import.meta.env.VITE_API_ORIGIN as string | undefined) ?? '').replace(/\/+$/, '');

/** True inside the Android app build. */
export const IS_APP = API_ORIGIN !== '';

export const apiUrl = (path: string) => API_ORIGIN + path;

/** The public address of the service, for invite and webhook links people share. */
export const publicOrigin = () => API_ORIGIN || window.location.origin;

const TOKEN_KEY = 'lgcp.token';

export function getToken(): string | null {
  if (!IS_APP) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null | undefined) {
  if (!IS_APP) return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

/** In the app, server-relative media paths (/uploads/...) must point at the API origin. */
export function absolutize<T>(data: T): T {
  if (!IS_APP) return data;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith('/uploads/') ? API_ORIGIN + v : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(data) as T;
}
