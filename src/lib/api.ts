// One place that knows where the API lives and how requests authenticate.
//
// Web (bg.skeptrune.com): the API is same-origin, so paths stay relative and
// the better-auth session cookie rides along as a first-party cookie.
//
// Native app (the PWA bundled inside the iOS/Android shell, built with
// `vite build --mode native`): the page is served from a loopback origin inside
// the app, so the API is cross-site. WebViews block third-party cookies (WKWebView
// ITP), so the native build authenticates with a bearer token instead: better-auth's
// bearer plugin returns the session token in a `set-auth-token` header at sign-in,
// we keep it in localStorage, and send it as `Authorization: Bearer` on every
// API call. Requests never carry cookies (credentials: 'omit').

export const IS_NATIVE = import.meta.env.VITE_NATIVE === '1';

/** Absolute API origin for the native build; '' on the web (same-origin). */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

const TOKEN_KEY = 'bg.authToken';

export function getAuthToken(): string | null {
  if (!IS_NATIVE) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  if (!IS_NATIVE) return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session simply won't survive a relaunch */
  }
}

export function apiUrl(path: string): string {
  return API_BASE + path;
}

/** fetch() for `/api/*` paths, with the platform's auth attached. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!IS_NATIVE) return fetch(path, { credentials: 'include', ...init });
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(apiUrl(path), { ...init, headers, credentials: 'omit' });
}
