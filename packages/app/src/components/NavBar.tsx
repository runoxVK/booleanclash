import type { Route } from '../router';

interface NavBarProps {
  readonly route: Route;
  readonly onNavigate: (route: Route) => void;
  readonly solved: number;
  readonly total: number;
}

export function NavBar({ route, onNavigate, solved, total }: NavBarProps) {
  const tab = (id: Route, label: string) => (
    <button
      key={id}
      className={route === id ? 'nav-tab active' : 'nav-tab'}
      onClick={() => onNavigate(id)}
    >
      {label}
    </button>
  );

  return (
    <nav className="nav">
      <button className="brand" onClick={() => onNavigate('home')}>
        LOGICLASH
      </button>
      <div className="nav-tabs">
        {tab('play', 'Play')}
        {tab('learn', 'Learn')}
      </div>
      <span className="nav-progress">
        {solved}/{total} solved
      </span>
    </nav>
  );
}
