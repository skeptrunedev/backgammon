import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { API_BASE, IS_NATIVE, apiFetch, getAuthToken, setAuthToken } from '../lib/api';

// Web: same-origin, cookie session. Native: cross-site API with a bearer token
// (see src/lib/api.ts for why).
export const authClient = createAuthClient({
  baseURL: API_BASE || window.location.origin,
  fetchOptions: IS_NATIVE
    ? {
        credentials: 'omit',
        auth: { type: 'Bearer', token: () => getAuthToken() ?? undefined },
        onSuccess(ctx) {
          // Sign-in (and session refresh) responses carry the session token.
          const token = ctx.response.headers.get('set-auth-token');
          if (token) setAuthToken(token);
        },
      }
    : { credentials: 'include' },
  plugins: [emailOTPClient()],
});

// Hydrate the session store on cold load so a returning user with a valid
// session is recognized without having to sign in again.
void authClient.getSession();

/** Sign out and forget the native bearer token. */
export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    setAuthToken(null);
  }
}

/**
 * Permanently delete the signed-in account and all of its server-side data,
 * then drop the local session. Throws if the server refused.
 */
export async function deleteAccount(): Promise<void> {
  const res = await apiFetch('/api/me', { method: 'DELETE' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not delete the account (HTTP ${res.status}).`);
  }
  // The session row is gone; sign-out clears the cookie/token and the session store.
  await signOut();
}

/** Convenience wrapper around authClient.useSession(). */
export function useUser() {
  const { data, isPending } = authClient.useSession();
  return {
    user: data?.user ?? null,
    isPending,
  };
}
