interface HowToPlayProps {
  readonly onClose: () => void;
}

/**
 * Shown on a first visit, and reopenable from the header.
 *
 * Kept to five steps in the order you actually need them. Anything longer does
 * not get read, and the coach line handles the moment-to-moment guidance — this
 * only has to establish the shape of the game.
 */
export function HowToPlay({ onClose }: HowToPlayProps) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="how-to" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>

        <ol>
          <li>
            <strong>The goal.</strong> The <em>want</em> column on the right is
            the circuit you have to build. Match it for every row, using as few
            parts as possible.
          </li>
          <li>
            <strong>Build by selecting, not dragging.</strong> Click a part on
            the board to select it, then click a gate in the toolbox. The gate
            wires itself to whatever you had selected — so click{' '}
            <code>a</code>, click <code>b</code>, then click{' '}
            <code>and</code>.
          </li>
          <li>
            <strong>Flip the switches</strong> under the inputs to watch signals
            travel up the board. Live wires light up green. Clicking a row of the
            table throws the switches to match that row.
          </li>
          <li>
            <strong>Matching part wins.</strong> As soon as any part computes the
            target, it docks to the output on the ceiling and the puzzle is
            solved.
          </li>
          <li>
            <strong>Merging is how you get under par.</strong> If you build the
            same shape twice on <em>different</em> signals, the Merge button
            lights up and turns it into a reusable chip — which costs just 1 to
            place again instead of rebuilding it.
          </li>
        </ol>

        <p className="keys">
          <kbd>N</kbd> not · <kbd>A</kbd> and · <kbd>O</kbd> or · <kbd>M</kbd>{' '}
          merge · <kbd>U</kbd> undo · <kbd>Esc</kbd> clear · <kbd>Del</kbd>{' '}
          delete
        </p>

        <button onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
