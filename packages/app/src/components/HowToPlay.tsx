interface HowToPlayProps {
  readonly onClose: () => void;
}

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
            <strong>Place parts.</strong> Click a gate in the toolbox to pick it
            up, then click any empty cell on the grid to drop it. It stays
            picked up, so you can lay down a row of them. Drag a part to move it.
          </li>
          <li>
            <strong>Wire it.</strong> Drag from a part&rsquo;s <em>top</em> pin
            down into another part&rsquo;s <em>bottom</em> pin. Dashed hollow
            pins are empty. Click a filled pin to pull its wire out. One output
            can feed as many pins as you like, for free.
          </li>
          <li>
            <strong>Room to work.</strong> The grid is bigger than the screen.
            Scroll to zoom, drag empty board to pan, and the{' '}
            <strong>%</strong> button snaps back to the whole board.
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
            <strong>Packaging is how you get under par.</strong> Your score is
            simply how many units are wired up, and a chip is one unit however
            many gates went into it. If a cluster on your board adds up to a
            component from the <strong>Components</strong> list — a XOR, a NAND,
            a MUX — select those parts and press <kbd>M</kbd>. They collapse
            into one, and the component joins your toolbox to place again.
            <em>
              {' '}
              Recognising it is the game — nothing will point it out for you.
            </em>
          </li>
          <li>
            <strong>You cannot package everything.</strong> Only functions in the
            catalogue can be packaged, and your final answer is not one of them,
            so there is no collapsing the whole circuit into a single chip.
          </li>
        </ol>
        <p className="keys">
          <kbd>N</kbd> not · <kbd>A</kbd> and · <kbd>O</kbd> or ·{' '}
          <kbd>M</kbd> merge · <kbd>U</kbd> undo · <kbd>Esc</kbd> clear ·{' '}
          <kbd>Del</kbd> delete
        </p>
        <button onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
