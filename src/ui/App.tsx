import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import HomeScreen from './HomeScreen';
import PlayScreen from './PlayScreen';
import AnalysisScreen from './AnalysisScreen';
import AuthDialog from './AuthDialog';
import { authClient, useUser } from '../auth/client';
import { pullMatches } from '../game/sync';
import { Separator } from '@/components/ui/separator';
import { Menu, X, Home, LogIn, LogOut } from 'lucide-react';

export default function App() {
  return (
    <BrowserRouter>
      <Chrome />
    </BrowserRouter>
  );
}

function Chrome() {
  const { pathname } = useLocation();
  const fullscreen = pathname.startsWith('/play');

  if (fullscreen) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <SessionPuller />
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/play/:matchId" element={<PlayScreen />} />
          <Route path="/match/:id" element={<AnalysisScreen />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <SessionPuller />
      <AppDrawer />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-6 pt-16 sm:px-6">
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/play/:matchId" element={<PlayScreen />} />
          <Route path="/match/:id" element={<AnalysisScreen />} />
        </Routes>
      </div>
    </div>
  );
}

function SessionPuller() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId) void pullMatches();
  }, [userId]);
  return null;
}

// Left side drawer for the non-fullscreen routes (home, analysis). Replaces the
// old top header — a hamburger button opens it; it holds branding, navigation,
// and the auth controls.
function AppDrawer() {
  const { user, isPending } = useUser();
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="fixed left-3 top-3 z-40 flex size-9 items-center justify-center rounded-lg border border-white/10 bg-background/70 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[80vw] flex-col gap-5 border-r border-white/10 bg-card p-4 pl-[max(1rem,env(safe-area-inset-left))] shadow-2xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span aria-hidden className="text-lg leading-none text-primary">
                  ⚄
                </span>
                <h2 className="text-lg font-semibold text-foreground">Backgammon</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <p className="-mt-3 text-xs text-muted-foreground">vs GNU Backgammon</p>

            <Link
              to="/"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <Home className="size-4" />
              Home
            </Link>

            <Separator />

            {user ? (
              <div className="flex flex-col gap-2 px-1">
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void authClient.signOut();
                  }}
                  className="flex items-center gap-3 rounded-lg px-1 py-2 text-sm text-foreground hover:bg-accent"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setOpen(false);
                  setAuthOpen(true);
                }}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
              >
                <LogIn className="size-4" />
                Sign in
              </button>
            )}
          </div>
        </div>
      )}

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}
