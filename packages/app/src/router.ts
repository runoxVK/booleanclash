import { useEffect, useState } from 'react';

/**
 * A hash router, deliberately.
 *
 * Path-based routing needs the host to rewrite unknown paths to index.html, and
 * this game is meant to be droppable on any static host — including one where
 * you cannot configure that. Hashes work everywhere with no server config, and
 * they cost nothing here because the app is one page deep.
 */
export const ROUTES = ['home', 'play', 'learn'] as const;
export type Route = (typeof ROUTES)[number];

function read(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : 'home';
}

export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const go = (next: Route) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
    window.scrollTo(0, 0);
  };

  return [route, go];
}
