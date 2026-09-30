import { runInNewContext } from 'node:vm';
import { signingKeyScript } from '../util/html';

interface FakeNode {
  textContent: string;
  children: FakeNode[];
  appendChild(child: FakeNode): void;
}

function fakeNode(textContent = ''): FakeNode {
  return {
    textContent,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };
}

const fakeDocument = {
  createTextNode: (t: string) => fakeNode(t),
  createElement: () => fakeNode(),
};

interface SigningKeyUi {
  command(nonce: string, key: string | null): string;
  renderNote(el: FakeNode, key: string | null): void;
}

const ui = runInNewContext(`${signingKeyScript()}; SigningKeyUi`, {
  document: fakeDocument,
}) as SigningKeyUi;

function noteText(key: string | null): string {
  const el = fakeNode('stale');
  ui.renderNote(el, key);
  return el.children.map((c) => c.textContent).join('');
}

describe('btcli sign command', () => {
  it('signs with the named wallet coldkey and no hotkey flag', () => {
    expect(ui.command('abc123', 'coldkey')).toBe("btcli wallet sign -w <wallet> --message 'abc123'");
  });

  it('names the wallet and hotkey when a hotkey is required', () => {
    expect(ui.command('abc123', 'hotkey')).toBe(
      "btcli wallet sign -w <wallet> -H <hotkey> --use-hotkey --message 'abc123'",
    );
  });

  it('defaults to the coldkey when either key is accepted', () => {
    expect(ui.command('abc123', null)).toBe("btcli wallet sign -w <wallet> --message 'abc123'");
  });

  it.each(['coldkey', 'hotkey', null])('never emits the btcli 9-only --no-use-hotkey flag (%s)', (key) => {
    expect(ui.command('n', key)).not.toContain('--no-use-hotkey');
    expect(noteText(key)).not.toContain('--no-use-hotkey');
  });
});

describe('btcli sign note', () => {
  it('asks for the coldkey wallet name', () => {
    expect(noteText('coldkey')).toBe(
      'Run this in your terminal, replacing <wallet> with the name of the wallet that holds your coldkey.',
    );
  });

  it('asks for the wallet and hotkey names', () => {
    expect(noteText('hotkey')).toBe(
      'Run this in your terminal, replacing <wallet> with your wallet name and <hotkey> with the hotkey name.',
    );
  });

  it('explains how to switch to a hotkey when either key is accepted', () => {
    expect(noteText(null)).toBe(
      'Run this in your terminal, replacing <wallet> with your wallet name. ' +
        'It signs with the coldkey; to sign with a hotkey, add -H <hotkey> --use-hotkey.',
    );
  });

  it('replaces any previous note', () => {
    const el = fakeNode('stale');
    ui.renderNote(el, 'coldkey');
    expect(el.textContent).toBe('');
  });
});
