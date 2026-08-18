import { COMPONENTS } from '@logiclash/engine';
import { RESOURCE_GROUPS } from '../learn/resources';
import type { Route } from '../router';

const KIND_LABEL: Record<string, string> = {
  read: 'Read',
  watch: 'Watch',
  play: 'Play',
};

/** A small truth table, written out inline in a lesson. */
function MiniTable({
  inputs,
  rows,
  label,
}: {
  readonly inputs: readonly string[];
  readonly rows: readonly (readonly number[])[];
  readonly label: string;
}) {
  return (
    <table className="mini-truth">
      <thead>
        <tr>
          {inputs.map((name) => (
            <th key={name}>{name}</th>
          ))}
          <th className="out">{label}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className={j === row.length - 1 ? 'out' : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface LearnProps {
  readonly onNavigate: (route: Route) => void;
}

export function Learn({ onNavigate }: LearnProps) {
  return (
    <div className="page learn">
      <header className="page-head">
        <h1>Learn</h1>
        <p>
          Everything Logiclash asks of you, from the beginning. None of it
          assumes you have seen a logic gate before.
        </p>
      </header>

      <section className="lesson">
        <h2>1. A circuit is a rule, not a wire</h2>
        <p>
          Each input — <code>a</code>, <code>b</code>, <code>c</code> — is either
          off (<code>0</code>) or on (<code>1</code>). With two inputs there are
          four possible settings; with four inputs, sixteen. A circuit&rsquo;s
          job is to say what the output should be for <em>every one of them</em>.
        </p>
        <p>
          That is what the <strong>TARGET</strong> panel is. The{' '}
          <code>WANT</code> column lists the answer for every row, top to bottom.
          Your circuit is correct when its column matches, all the way down —
          not just for the case you happen to be looking at.
        </p>
        <MiniTable
          inputs={['b', 'a']}
          rows={[
            [0, 0, 0],
            [0, 1, 1],
            [1, 0, 1],
            [1, 1, 0],
          ]}
          label="want"
        />
        <p className="aside">
          This one is on when exactly one input is on. It has a name: XOR.
        </p>
      </section>

      <section className="lesson">
        <h2>2. Three gates, and that is genuinely all</h2>
        <p>
          You get <strong>NOT</strong>, <strong>AND</strong> and{' '}
          <strong>OR</strong>. Every circuit in the game is built from those
          three, and that is not a limitation of the game — those three can
          express <em>any</em> rule you can write in a truth table.
        </p>
        <div className="gate-row">
          <div>
            <h3>not</h3>
            <MiniTable inputs={['a']} rows={[[0, 1], [1, 0]]} label="out" />
            <p>Flips it.</p>
          </div>
          <div>
            <h3>and</h3>
            <MiniTable
              inputs={['b', 'a']}
              rows={[
                [0, 0, 0],
                [0, 1, 0],
                [1, 0, 0],
                [1, 1, 1],
              ]}
              label="out"
            />
            <p>On only when both are on.</p>
          </div>
          <div>
            <h3>or</h3>
            <MiniTable
              inputs={['b', 'a']}
              rows={[
                [0, 0, 0],
                [0, 1, 1],
                [1, 0, 1],
                [1, 1, 1],
              ]}
              label="out"
            />
            <p>On when either is on.</p>
          </div>
        </div>
      </section>

      <section className="lesson">
        <h2>3. Reusing a signal is free</h2>
        <p>
          One output pin can feed as many input pins as you like, and it costs
          nothing extra. If you have already computed <code>a AND b</code>, wire
          it into three different places rather than building it three times.
        </p>
        <p>
          This matters more than it sounds. A great deal of the difference
          between a nine-part circuit and a five-part one is noticing that you
          computed the same signal twice.
        </p>
      </section>

      <section className="lesson">
        <h2>4. Building XOR, the worked example</h2>
        <p>
          XOR is on when the inputs differ. There is no XOR gate in the toolbox,
          so you build it. The usual way:
        </p>
        <p className="formula">and( or(a, b), not( and(a, b) ) )</p>
        <p>
          Read it as: <em>at least one is on</em>, <strong>and</strong>{' '}
          <em>not both are on</em>. Four parts. Build that, select all four, and
          the game recognises it — four units become one.
        </p>
        <p className="aside">
          There are other ways. <code>or( and(a, not b), and(not a, b) )</code>{' '}
          is the same function in five parts. Both get recognised, because
          recognition is by behaviour, not by shape — but one costs you more.
        </p>
      </section>

      <section className="lesson">
        <h2>5. De Morgan&rsquo;s laws — the part-saving trick</h2>
        <p>Two rewrites that are always true:</p>
        <p className="formula">not(a and b) = (not a) or (not b)</p>
        <p className="formula">not(a or b) = (not a) and (not b)</p>
        <p>
          They let you push inverters through a circuit and swap ANDs for ORs.
          Very often a circuit that needs three inverters one way round needs one
          the other way. When you are stuck a part or two above par, this is the
          first thing to try.
        </p>
      </section>

      <section className="lesson">
        <h2>6. Components are where the score is</h2>
        <p>
          Your score is how many units are wired into the answer, and a{' '}
          <strong>chip counts as one</strong> however many gates went into it. So
          the game is really: spot a cluster on your board that adds up to a
          known component, and package it.
        </p>
        <p>
          You cannot package everything — only the functions below. Your final
          answer is some arbitrary rule, and arbitrary rules are not on the list,
          so there is no collapsing the whole circuit into a single chip.
        </p>
        <ul className="component-list">
          {COMPONENTS.map((component) => (
            <li key={`${component.arity}-${component.name}`}>
              <span className="cname">{component.name}</span>
              <span className="cpins">{component.arity} pins</span>
              <span className="cblurb">{component.blurb}</span>
            </li>
          ))}
        </ul>
        <p className="aside">
          Once packaged, a component joins your toolbox and can be placed again
          for one unit — so the second time you need a XOR, you do not rebuild
          it.
        </p>
      </section>

      <section className="lesson">
        <h2>7. Where to go next</h2>
        <p>
          Checked links, grouped by what you are after. They open in a new tab.
        </p>
        {RESOURCE_GROUPS.map((group) => (
          <div className="resource-group" key={group.heading}>
            <h3>{group.heading}</h3>
            <p className="aside">{group.blurb}</p>
            <ul className="resources">
              {group.items.map((item) => (
                <li key={item.url}>
                  <a href={item.url} target="_blank" rel="noreferrer noopener">
                    <span className={`kind kind-${item.kind}`}>
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="rtitle">{item.title}</span>
                  </a>
                  <span className="rnote">{item.note}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <div className="page-cta">
        <button onClick={() => onNavigate('play')}>Go and build something</button>
      </div>
    </div>
  );
}
