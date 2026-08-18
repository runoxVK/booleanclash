import { useState } from 'react';
import { NavBar } from './components/NavBar';
import { Home } from './pages/Home';
import { Duel } from './pages/Duel';
import { Race } from './pages/Race';
import { Learn } from './pages/Learn';
import { Play } from './pages/Play';
import { loadProgress, type Progress } from './progress';
import { PUZZLES } from './puzzles';
import { useRoute } from './router';

/**
 * Site shell.
 *
 * Play stays mounted and is merely hidden when you are on another page, so
 * wandering off to Learn mid-puzzle does not throw away the circuit you were
 * building. Progress lives up here because the nav bar and the home page both
 * need it, and it is the one piece of state shared across pages.
 */
export function App() {
  const [route, go] = useRoute();
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [request, setRequest] = useState<{ id: string; ticket: number } | null>(
    null,
  );

  const playPuzzle = (id: string) => {
    setRequest((previous) => ({ id, ticket: (previous?.ticket ?? 0) + 1 }));
    go('play');
  };

  const solved = PUZZLES.filter((p) => progress[p.id] !== undefined).length;

  return (
    <div className="site">
      <NavBar
        route={route}
        onNavigate={go}
        solved={solved}
        total={PUZZLES.length}
      />
      <div className="site-body">
        {route === 'home' && (
          <Home
            progress={progress}
            onNavigate={go}
            onPlayPuzzle={playPuzzle}
          />
        )}
        {route === 'race' && <Race />}
        {route === 'duel' && <Duel />}
        {route === 'learn' && <Learn onNavigate={go} />}
        <div className="play-host" hidden={route !== 'play'}>
          <Play
            active={route === 'play'}
            progress={progress}
            onProgress={setProgress}
            request={request}
          />
        </div>
      </div>
    </div>
  );
}
