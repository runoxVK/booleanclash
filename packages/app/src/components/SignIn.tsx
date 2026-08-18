import { useState } from 'react';
import { net, type Player } from '../net';

/**
 * Pick a handle and get a token. Shared by every online mode.
 *
 * Deliberately the thinnest thing that works: no password, no email. Fine for
 * playing with friends, and the first thing to replace before this is public.
 */
export function SignIn({
  onSignedIn,
  onError,
}: {
  readonly onSignedIn: (player: Player) => void;
  readonly onError: (message: string) => void;
}) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (handle.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      onSignedIn(await net.signUp(handle.trim()));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="signin">
      <h2>Pick a handle</h2>
      <p className="aside">
        No password and no email — a handle gets you a token, kept in this
        browser. Good enough to play with a friend; not good enough to be public.
      </p>
      <div className="signin-row">
        <input
          value={handle}
          maxLength={20}
          placeholder="handle"
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <button className="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Continue'}
        </button>
      </div>
    </section>
  );
}
