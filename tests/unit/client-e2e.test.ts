/**
 * End-to-end tests of ImapClient against an in-process scripted IMAP server.
 *
 * Unlike the unit/property suites, which feed strings to the parsers, these
 * drive the real stack -- ImapConnection (TCP socket) -> ImapProtocol (tagging,
 * literals, continuations) -> ImapClient -- over a loopback socket, so a
 * regression in how the layers are wired together shows up here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { AddressInfo } from 'node:net';
import { ImapClient } from '../../src/client';

type Reply = (tag: string, args: string, sock: net.Socket) => void;

interface FakeServer {
  port: number;
  commands: string[];
  handlers: Map<string, Reply>;
  greeting: string;
  close(): Promise<void>;
}

const CRLF = '\r\n';

async function startServer(): Promise<FakeServer> {
  const commands: string[] = [];
  const handlers = new Map<string, Reply>();
  const sockets = new Set<net.Socket>();
  const state = { greeting: '* OK [CAPABILITY IMAP4rev1 IDLE UIDPLUS] fake ready' };

  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.write(state.greeting + CRLF);
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf(CRLF)) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (line === 'DONE') {
          const h = handlers.get('DONE');
          if (h) h('', '', sock);
          continue;
        }
        const m = /^(\S+) (UID \S+|\S+)\s?(.*)$/.exec(line);
        if (!m) continue;
        const [, tag, rawCmd, args] = m;
        const cmd = rawCmd!.toUpperCase();
        commands.push(`${cmd} ${args}`.trim());
        const h = handlers.get(cmd);
        if (h) h(tag!, args!, sock);
        else sock.write(`${tag} OK ${cmd} completed${CRLF}`);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fake: FakeServer = {
    port: (server.address() as AddressInfo).port,
    commands,
    handlers,
    get greeting() { return state.greeting; },
    set greeting(g: string) { state.greeting = g; },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
  return fake;
}

function lines(sock: net.Socket, ...ls: string[]): void {
  sock.write(ls.join(CRLF) + CRLF);
}

function installMailbox(srv: FakeServer): void {
  srv.handlers.set('LOGIN', (tag, args, sock) => {
    if (/\bwrong\b/.test(args)) lines(sock, `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
    else lines(sock, `${tag} OK [CAPABILITY IMAP4rev1 IDLE UIDPLUS MOVE] Logged in`);
  });
  srv.handlers.set('LIST', (tag, _a, sock) =>
    lines(
      sock,
      '* LIST (\\HasNoChildren) "/" INBOX',
      '* LIST (\\HasChildren) "/" Work',
      '* LIST (\\HasNoChildren) "/" "Work/Q3 Reports"',
      `${tag} OK LIST completed`,
    ),
  );
  const select: Reply = (tag, _a, sock) =>
    lines(
      sock,
      '* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)',
      '* OK [PERMANENTFLAGS (\\Deleted \\Seen \\*)] Limited',
      '* 3 EXISTS',
      '* 1 RECENT',
      '* OK [UIDVALIDITY 1700000000] UIDs valid',
      '* OK [UIDNEXT 104] Predicted next UID',
      `${tag} OK [READ-WRITE] SELECT completed`,
    );
  srv.handlers.set('SELECT', select);
  srv.handlers.set('EXAMINE', select);
  srv.handlers.set('UID SEARCH', (tag, args, sock) => {
    if (/FROM "?nobody"?/.test(args)) lines(sock, '* SEARCH', `${tag} OK SEARCH completed`);
    else lines(sock, '* SEARCH 101 102 103', `${tag} OK SEARCH completed`);
  });
  srv.handlers.set('UID FETCH', (tag, _a, sock) => {
    const header = 'Subject: Hello\r\nFrom: a@example.com\r\n\r\n';
    const len = Buffer.byteLength(header);
    sock.write(
      `* 1 FETCH (UID 101 FLAGS (\\Seen) RFC822.SIZE 512 BODY[HEADER] {${len}}${CRLF}${header})${CRLF}` +
        `* 2 FETCH (UID 102 FLAGS () RFC822.SIZE 256 BODY[HEADER] {${len}}${CRLF}${header})${CRLF}` +
        `${tag} OK FETCH completed${CRLF}`,
    );
  });
}

describe('ImapClient end-to-end over a loopback socket', () => {
  let srv: FakeServer;
  let client: ImapClient | null = null;

  beforeEach(async () => {
    srv = await startServer();
    installMailbox(srv);
  });

  afterEach(async () => {
    if (client) await client.end().catch(() => undefined);
    client = null;
    await srv.close();
  });

  const connect = (password = 'secret') =>
    ImapClient.connect({
      imap: {
        host: '127.0.0.1',
        port: srv.port,
        user: 'user@example.com',
        password,
        tls: false,
        authTimeout: 2000,
        connTimeout: 2000,
      },
    });

  it('logs in, picks up capabilities from the LOGIN response, and logs out', async () => {
    client = await connect();
    expect(srv.commands[0]).toMatch(/^LOGIN "?user@example\.com"? "?secret"?$/);
    await client.end();
    expect(srv.commands.at(-1)).toBe('LOGOUT');
    client = null;
  });

  it('rejects bad credentials with the server text', async () => {
    await expect(connect('wrong')).rejects.toThrow(/Invalid credentials|AUTHENTICATIONFAILED|NO/);
  });

  it('rejects a server that greets with BYE', async () => {
    srv.greeting = '* BYE too busy';
    await expect(connect()).rejects.toThrow(/rejected/i);
  });

  it('lists mailboxes into a tree, including quoted names with spaces', async () => {
    client = await connect();
    const boxes = await client.getBoxes();
    expect(Object.keys(boxes)).toEqual(expect.arrayContaining(['INBOX', 'Work']));
    expect(boxes.Work!.delimiter).toBe('/');
    expect(Object.keys(boxes.Work!.children ?? {})).toContain('Q3 Reports');
  });

  it('refuses mailbox-scoped operations before a mailbox is selected', async () => {
    client = await connect();
    await expect(client.search(['ALL'])).rejects.toThrow();
    await expect(client.expunge()).rejects.toThrow();
  });

  it('opens a mailbox and parses its status', async () => {
    client = await connect();
    const box = await client.openBox('INBOX');
    expect(srv.commands).toContainEqual(expect.stringMatching(/^SELECT "?INBOX"?$/));
    expect(box).toMatchObject({ name: 'INBOX', readOnly: false, uidvalidity: 1700000000, uidnext: 104 });
    expect(box.messages.total).toBe(3);
    expect(box.flags).toContain('\\Seen');
  });

  it('uses EXAMINE for a read-only open', async () => {
    client = await connect();
    const box = await client.openBox('INBOX', true);
    expect(srv.commands).toContainEqual(expect.stringMatching(/^EXAMINE "?INBOX"?$/));
    expect(box.readOnly).toBe(true);
  });

  it('searches by UID and returns an empty list without a follow-up FETCH', async () => {
    client = await connect();
    await client.openBox('INBOX');
    expect(await client.search(['ALL'])).toEqual([101, 102, 103]);
    expect(await client.search([['FROM', 'nobody']])).toEqual([]);
    expect(srv.commands.filter((c) => c.startsWith('UID FETCH'))).toHaveLength(0);
  });

  it('search + fetch returns messages with literal bodies intact', async () => {
    client = await connect();
    await client.openBox('INBOX');
    const msgs = await client.search(['ALL'], { bodies: ['HEADER'] });
    expect(srv.commands.some((c) => c.startsWith('UID FETCH 101,102,103'))).toBe(true);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.attributes.uid).toBe(101);
    expect(msgs[0]!.attributes.flags).toContain('\\Seen');
    const part = msgs[0]!.parts.find((p) => p.which === 'HEADER');
    expect(String(part?.body)).toContain('Subject: Hello');
  });

  it('fetch with an empty UID list sends nothing', async () => {
    client = await connect();
    await client.openBox('INBOX');
    expect(await client.fetch([], { bodies: 'HEADER' })).toEqual([]);
    expect(srv.commands.some((c) => c.startsWith('UID FETCH'))).toBe(false);
  });

  it('sends UID STORE / COPY / EXPUNGE for flag and move operations', async () => {
    client = await connect();
    await client.openBox('INBOX');
    await client.addFlags([101], ['\\Seen']);
    await client.delFlags([102], ['\\Flagged']);
    await client.move([103], 'Archive');
    await client.expunge();
    expect(srv.commands).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^UID STORE 101 \+FLAGS/),
        expect.stringMatching(/^UID STORE 102 -FLAGS/),
        expect.stringMatching(/^UID COPY 103 "?Archive"?$/),
        expect.stringMatching(/^UID STORE 103 \+FLAGS.*\\Deleted/),
        'EXPUNGE',
      ]),
    );
  });

  it('no-ops flag/copy calls with nothing to do', async () => {
    client = await connect();
    await client.openBox('INBOX');
    const before = srv.commands.length;
    await client.addFlags([], ['\\Seen']);
    await client.delFlags([1], []);
    await client.copy([], 'X');
    await client.move([], 'X');
    expect(srv.commands.length).toBe(before);
  });

  it('creates, renames and deletes mailboxes', async () => {
    client = await connect();
    await client.addBox('Tmp');
    await client.renameBox('Tmp', 'Tmp2');
    await client.delBox('Tmp2');
    expect(srv.commands).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^CREATE "?Tmp"?$/),
        expect.stringMatching(/^RENAME "?Tmp"? "?Tmp2"?$/),
        expect.stringMatching(/^DELETE "?Tmp2"?$/),
      ]),
    );
  });

  it('surfaces a tagged NO from the server as a rejection', async () => {
    srv.handlers.set('CREATE', (tag, _a, sock) => lines(sock, `${tag} NO [ALREADYEXISTS] Mailbox exists`));
    client = await connect();
    await expect(client.addBox('INBOX')).rejects.toThrow(/exists/i);
  });

  it('IDLE delivers numeric EXISTS/EXPUNGE/RECENT and FETCH uid+flags (not NaN)', async () => {
    let idleTag = '';
    srv.handlers.set('IDLE', (tag, _a, sock) => {
      idleTag = tag;
      lines(sock, '+ idling');
      setTimeout(
        () => lines(sock, '* 4 EXISTS', '* 2 EXPUNGE', '* 1 RECENT', '* 1 FETCH (UID 101 FLAGS (\\Seen \\Flagged))'),
        20,
      );
    });
    srv.handlers.set('DONE', (_t, _a, sock) => lines(sock, `${idleTag} OK IDLE terminated`));

    client = await connect();
    await client.openBox('INBOX');
    const idle = await client.idle();
    const got = { exists: 0, expunge: 0, recent: 0, fetch: null as null | { uid?: number; flags?: string[]; seqno?: number } };
    const done = new Promise<void>((resolve) => {
      idle.on('exists', (n: number) => (got.exists = n));
      idle.on('expunge', (n: number) => (got.expunge = n));
      idle.on('recent', (n: number) => (got.recent = n));
      idle.on('fetch', (f) => {
        got.fetch = f;
        resolve();
      });
    });
    await done;
    expect(got.exists).toBe(4);
    expect(got.expunge).toBe(2);
    expect(got.recent).toBe(1);
    expect(got.fetch).toMatchObject({ seqno: 1, uid: 101 });
    expect(got.fetch!.flags).toEqual(['\\Seen', '\\Flagged']);
    await idle.stop();
    expect(idle.isActive).toBe(false);
  });

  it('rejects a second concurrent IDLE', async () => {
    srv.handlers.set('IDLE', (_tag, _a, sock) => lines(sock, '+ idling'));
    client = await connect();
    await client.openBox('INBOX');
    await client.idle();
    await expect(client.idle()).rejects.toThrow(/Already in IDLE/);
  });

  it('emits close when the server drops the connection', async () => {
    client = await connect();
    const closed = new Promise<void>((resolve) => client!.once('close', () => resolve()));
    await srv.close();
    await closed;
    await expect(client.getBoxes()).rejects.toThrow();
    client = null;
    srv = await startServer(); // afterEach closes a fresh server
  });
});
