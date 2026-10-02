import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const CONTACT = 'me@skeptrune.com';
const UPDATED = 'September 26, 2026';

// Plain-language privacy policy for bg.skeptrune.com and the Backgammon Android
// app. Keep it in step with what worker/index.ts, worker/auth.ts and migrations/
// actually store: every claim here should map to code.
export default function PrivacyScreen() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Privacy policy</h1>
        <p className="text-sm text-muted-foreground">
          Backgammon (bg.skeptrune.com and the Backgammon Android app). Last updated {UPDATED}.
        </p>
      </div>

      <Section title="The short version">
        <p>
          You can play without an account. There are no ads, no analytics, no tracking and no
          crash reporting. If you sign in, we store your email address and your matches so they
          sync across devices. We never sell your data.
        </p>
      </Section>

      <Section title="Without an account">
        <p>
          Matches, analysis and training progress are saved only on your device (browser storage
          on the web, app storage on Android). The game engine runs on your device. The app
          downloads the engine files from bg.skeptrune.com, which is hosted on Cloudflare, so
          Cloudflare handles those requests like any web request (including your IP address).
        </p>
        <p>The Android app has no sign-in and sends nothing else to us.</p>
      </Section>

      <Section title="If you sign in (website)">
        <p>Sign-in is by a one-time code sent to your email. When you sign in we store:</p>
        <ul className="list-disc pl-5">
          <li>Your email address and account creation date.</li>
          <li>
            Session records: a session token, its expiry, and the IP address and browser user agent
            of the device that signed in.
          </li>
          <li>Your matches, including every move and the engine&apos;s analysis of it.</li>
          <li>Your training and pip-counting progress and settings.</li>
          <li>Your AI trends analysis text, if you generate one.</li>
          <li>
            Your Anthropic API key, if you add one. It is encrypted (AES-256-GCM) before it is
            stored and is never sent back to your browser.
          </li>
        </ul>
        <p>
          The sign-in code is emailed through Fastmail. Everything is stored in a Cloudflare D1
          database and is sent over HTTPS.
        </p>
      </Section>

      <Section title="AI explanations and trends">
        <p>
          These features are optional and only work if you add your own Anthropic API key. When you
          ask for an explanation or a trends analysis, our server sends Anthropic (the maker of
          Claude) a text description of the relevant positions: checker placement, dice, the
          engine&apos;s ranked moves, your move and the match score. Your email and account details
          are not included. Anthropic processes the request under your own API account and its
          terms.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          You can delete any match from the home screen, which also deletes the synced copy. To
          delete your whole account and everything linked to it (synced matches, training
          progress, trends analysis and your stored API key), open the menu while signed in and
          choose <strong>Delete account</strong>. It takes effect immediately. You can also email{' '}
          <a className="text-primary underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>{' '}
          from the address you signed in with and we will delete it for you. Data on your device
          is removed when you clear the site&apos;s data or uninstall the app.
        </p>
      </Section>

      <Section title="Children">
        <p>The app is not directed at children under 13.</p>
      </Section>

      <Section title="Contact">
        <p>
          Questions:{' '}
          <a className="text-primary underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          . If this policy changes, the date above will change too.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm leading-relaxed text-foreground/90">
        {children}
      </CardContent>
    </Card>
  );
}
