import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import HomeScreen from './HomeScreen';
import PlayScreen from './PlayScreen';
import AnalysisScreen from './AnalysisScreen';
import AuthDialog from './AuthDialog';
import { authClient, useUser } from '../auth/client';
import { pullMatches } from '../game/sync';
import { Button } from '@/components/ui/button';

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
    <div className="flex min-h-dvh flex-col">
      <SessionPuller />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
          >
            <span aria-hidden className="text-lg leading-none text-primary">⚄</span>
            Backgammon
          </Link>
          <span className="text-xs text-muted-foreground">vs GNU Backgammon</span>
          <AuthControls />
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
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

function AuthControls() {
  const { user, isPending } = useUser();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="ml-auto flex min-w-0 items-center gap-2">
      {user ? (
        <>
          <span className="max-w-40 truncate text-xs text-muted-foreground sm:max-w-56">
            {user.email}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void authClient.signOut()}>
            Sign out
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => setDialogOpen(true)}
        >
          Sign in
        </Button>
      )}
      <AuthDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
