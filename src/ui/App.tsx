import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import HomeScreen from './HomeScreen';
import PlayScreen from './PlayScreen';
import AnalysisScreen from './AnalysisScreen';

export default function App() {
  return (
    <HashRouter>
      <div className="flex min-h-dvh flex-col">
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
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/play" element={<PlayScreen />} />
            <Route path="/match/:id" element={<AnalysisScreen />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  );
}
