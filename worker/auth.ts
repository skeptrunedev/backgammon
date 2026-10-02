import { betterAuth } from 'better-auth';
import { bearer, emailOTP } from 'better-auth/plugins';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { WorkerMailer } from 'worker-mailer';
import type { Env } from './env';

/** Origin of the PWA bundled in the native app (loopback server, any port). */
export const NATIVE_APP_ORIGIN_PATTERN = 'http://localhost:*';

export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: {
      db: new Kysely({ dialect: new D1Dialect({ database: env.DB }) }),
      type: 'sqlite',
    },
    trustedOrigins: [
      'https://bg.skeptrune.com',
      'http://localhost:5173',
      'http://localhost:5199',
      'http://localhost:8787',
      // The native iOS/Android app serves the bundled PWA from a loopback
      // server inside the app (mobile/modules/bundle-server). It authenticates
      // with bearer tokens and never sends cookies, so this only matters if a
      // cookie ever rides along; listed for completeness.
      NATIVE_APP_ORIGIN_PATTERN,
    ],
    plugins: [
      // Native app: session token in `set-auth-token` at sign-in, then
      // `Authorization: Bearer` (WebViews block third-party cookies).
      bearer(),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp }) {
          const mailer = await WorkerMailer.connect({
            host: env.SMTP_HOST,
            port: Number(env.SMTP_PORT),
            secure: true,
            credentials: {
              username: env.SMTP_USER,
              password: env.SMTP_PASSWORD,
            },
            authType: 'plain',
          });
          try {
            await mailer.send({
              from: { name: 'Backgammon', email: env.SMTP_USER },
              to: email,
              subject: `${otp} is your Backgammon sign-in code`,
              text: `Your Backgammon sign-in code is ${otp}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
            });
          } finally {
            await mailer.close();
          }
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
