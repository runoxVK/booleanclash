import { PUZZLES } from '../puzzles';
import type { Progress } from '../progress';
import type { Route } from '../router';

interface HomeProps {
  readonly progress: Progress;
  readonly onNavigate: (route: Route) => void;
  readonly onPlayPuzzle: (puzzleId: string) => void;
}

export function Home({ progress, onNavigate, onPlayPuzzle }: HomeProps) {
  const solved = PUZZLES.filter((p) => progress[p.id] !== undefined);
  /* "Continue" should mean the first thing you have not done, not the first
     thing in the list — otherwise it sends you back to a puzzle you finished. */
  const next = PUZZLES.find((p) => progress[p.id] === undefined) ?? PUZZLES[0];
  const underPar = solved.filter((p) => (progress[p.id] ?? 0) < p.par).length;

  return (
    <div className="page home">
      <header className="hero">
        <h1>Logiclash</h1>
        <p className="tagline">
          You are given a rule. Build a circuit that obeys it, using as few parts
          as you can.
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={() => onPlayPuzzle(next.id)}>
            {solved.length === 0 ? 'Start playing' : `Continue · ${next.name}`}
          </button>
          <button onClick={() => onNavigate('learn')}>
            New to this? Start with Learn
          </button>
        </div>
      </header>

      <section className="stat-row">
        <div className="stat">
          <span className="stat-value">{solved.length}</span>
          <span className="stat-label">solved</span>
        </div>
        <div className="stat">
          <span className="stat-value">{PUZZLES.length - solved.length}</span>
          <span className="stat-label">remaining</span>
        </div>
        <div className="stat">
          <span className="stat-value">{underPar}</span>
          <span className="stat-label">under par</span>
        </div>
      </section>

      <section className="puzzle-index">
        <h2>Puzzles</h2>
        <div className="puzzle-grid">
          {PUZZLES.map((puzzle) => {
            const best = progress[puzzle.id];
            const beat = best !== undefined && best < puzzle.par;
            return (
              <button
                key={puzzle.id}
                className={`puzzle-card${best !== undefined ? ' done' : ''}`}
                onClick={() => onPlayPuzzle(puzzle.id)}
              >
                <span className="pname">
                  {puzzle.name}
                  {best !== undefined && <span className="ptick">✓</span>}
                </span>
                <span className="pmeta">
                  {puzzle.inputCount} inputs · par {puzzle.par}
                </span>
                <span className={`pbest${beat ? ' beat' : ''}`}>
                  {best !== undefined ? `best ${best}` : 'unsolved'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="how-row">
        <div>
          <h3>Read the target</h3>
          <p>
            The panel on the right lists what your circuit should output for
            every possible setting of the inputs. Match all of it.
          </p>
        </div>
        <div>
          <h3>Place and wire</h3>
          <p>
            Drop gates anywhere on the grid, then drag from a part&rsquo;s top
            pin into another&rsquo;s bottom pin. Flip the switches to watch
            signals travel.
          </p>
        </div>
        <div>
          <h3>Spot the components</h3>
          <p>
            A chip counts as one unit however many gates are inside. Recognise a
            XOR or a MUX in your own circuit, package it, and your score falls.
          </p>
        </div>
      </section>
    </div>
  );
}
