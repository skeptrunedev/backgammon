import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: { credentials: 'include' },
  plugins: [emailOTPClient()],
});

// Hydrate the session store on cold load so a returning user with a valid
// cookie is recognized without having to sign in again.
void authClient.getSession();

/** Convenience wrapper around authClient.useSession(). */
export function useUser() {
  const { data, isPending } = authClient.useSession();
  return {
    user: data?.user ?? null,
    isPending,
  };
}
