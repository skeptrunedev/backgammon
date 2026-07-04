import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { WorkerMailer } from 'worker-mailer';
import type { Env } from './env';

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
    ],
    plugins: [
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
