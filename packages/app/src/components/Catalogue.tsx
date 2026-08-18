import { COMPONENTS, type ChipRegistry } from '@logiclash/engine';

interface CatalogueProps {
  readonly registry: ChipRegistry;
}

/**
 * The list of components you are allowed to package.
 *
 * Shown rather than hidden on purpose. The skill is meant to be spotting that a
 * cluster on your board IS a XOR — not guessing which words the game happens to
 * know. Hiding the list would turn a recognition puzzle into a vocabulary quiz,
 * and this list is also the rule that stops you packaging your whole answer, so
 * the player deserves to see it.
 */
export function Catalogue({ registry }: CatalogueProps) {
  const owned = new Set([...registry.values()].map((chip) => chip.name));

  return (
    <div className="panel">
      <h2>Components</h2>
      <p className="caption catalogue-note">
        Build any of these out of gates, select the parts, and press{' '}
        <kbd>M</kbd> to package it into one unit.
      </p>
      <ul className="catalogue">
        {COMPONENTS.map((component) => (
          <li
            key={`${component.arity}-${component.name}`}
            className={owned.has(component.name) ? 'found' : undefined}
            title={component.blurb}
          >
            <span className="cname">{component.name}</span>
            <span className="cpins">{component.arity} pins</span>
            {owned.has(component.name) && <span className="ctick">✓</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
