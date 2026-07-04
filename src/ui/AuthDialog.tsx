import { useEffect, useState, type FormEvent } from 'react';
import { authClient } from '../auth/client';
import { pullMatches } from '../game/sync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const RESEND_COOLDOWN_S = 30;

export default function AuthDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Reset transient state whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setStep('email');
      setCode('');
      setError(null);
      setBusy(false);
      setCooldown(0);
    }
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const sendCode = async () => {
    const addr = email.trim();
    if (!addr) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({
      email: addr,
      type: 'sign-in',
    });
    setBusy(false);
    if (err) {
      setError(err.message ?? 'Could not send the code. Try again.');
      return;
    }
    setEmail(addr);
    setCode('');
    setStep('code');
    setCooldown(RESEND_COOLDOWN_S);
  };

  const verify = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.emailOtp({ email, otp: code });
    setBusy(false);
    if (err) {
      setError(err.message ?? 'That code didn’t work. Try again.');
      return;
    }
    onOpenChange(false);
    void pullMatches();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void (step === 'email' ? sendCode() : verify());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            {step === 'email'
              ? 'We’ll email you a one-time code. Your matches back up across devices.'
              : `Enter the 6-digit code we sent to ${email}.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {step === 'email' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-otp">One-time code</Label>
              <Input
                id="auth-otp"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                className="text-center font-mono text-lg tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-3 transition-colors hover:text-foreground"
                  onClick={() => {
                    setStep('email');
                    setCode('');
                    setError(null);
                  }}
                >
                  Use a different email
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy || cooldown > 0}
                  onClick={() => void sendCode()}
                >
                  {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
                </Button>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {step === 'email' ? (
            <Button type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          ) : (
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
