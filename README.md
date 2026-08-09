# @dyanet/imap

[![CI](https://github.com/dyanet/imap/actions/workflows/ci.yml/badge.svg)](https://github.com/dyanet/imap/actions/workflows/ci.yml)
[![Coverage](./.github/badges/coverage.svg)](https://github.com/dyanet/imap/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@dyanet/imap.svg)](https://www.npmjs.com/package/@dyanet/imap)
[![npm downloads](https://img.shields.io/npm/dm/@dyanet/imap.svg)](https://www.npmjs.com/package/@dyanet/imap)
[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-%40dyanet%2Fimap-2a1f18)](https://github.com/dyanet/imap/pkgs/npm/imap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, zero-dependency TypeScript IMAP client library that revives the discontinued [imap-simple](https://www.npmjs.com/package/imap-simple) package.

## Background

This library was created as a modern replacement for two popular but now obsolete IMAP libraries:

- **[imap-simple](https://www.npmjs.com/package/imap-simple)** - A popular wrapper around the `imap` package that simplified IMAP operations. Last updated in 2020, now deprecated.
- **[imap](https://www.npmjs.com/package/imap)** - The underlying IMAP client that `imap-simple` depended on. Last updated in 2019, no longer maintained.

Both libraries have known security vulnerabilities and are incompatible with modern Node.js versions. `@dyanet/imap` provides a fresh, zero-dependency implementation with a compatible API, making migration straightforward.

## Features

- **Zero Dependencies**: Uses only Node.js built-in modules (`net`, `tls`, `crypto`, `events`)
- **TypeScript First**: Written in TypeScript with strict mode, full type definitions included
- **imap-simple Compatible**: Drop-in replacement API for easy migration
- **Promise-Based**: Modern async/await API for all operations
- **OAuth2 Support**: XOAUTH2 authentication for Gmail and Microsoft 365
- **IMAP Extensions**: IDLE, CONDSTORE, QRESYNC support for real-time updates and efficient sync
- **Small Footprint**: Target bundle size under 50KB

## Installation

```bash
npm install @dyanet/imap
```

## Quick Start

```typescript
import { ImapClient } from '@dyanet/imap';

const client = await ImapClient.connect({
  imap: {
    host: 'imap.example.com',
    port: 993,
    user: 'user@example.com',
    password: 'password',
    tls: true
  }
});

// Open INBOX
const mailbox = await client.openBox('INBOX');
console.log(`Total messages: ${mailbox.messages.total}`);

// Search for unread messages
const messages = await client.search(['UNSEEN'], { bodies: ['HEADER'] });

// Process messages
for (const msg of messages) {
  console.log(`UID: ${msg.uid}, Flags: ${msg.attributes.flags}`);
}

// Close connection
await client.end();
```

## Architecture

The library follows a layered architecture that separates concerns and enables testability:

```
┌─────────────────────────────────────────────────────────────┐
│                    ImapClient (Public API)                  │
│  connect() | openBox() | search() | fetch() | move() | end()│
├─────────────────────────────────────────────────────────────┤
│                    Command Layer                            │
│  CommandBuilder | ResponseParser | MimeParser               │
├─────────────────────────────────────────────────────────────┤
│                    Protocol Layer                           │
│  ImapProtocol | TagGenerator | LiteralHandler               │
├─────────────────────────────────────────────────────────────┤
│                    Transport Layer                          │
│  ImapConnection | TLS/TCP Socket Management                 │
└─────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

- **Transport Layer**: Manages raw TCP/TLS socket connections using Node.js `net` and `tls` modules
- **Protocol Layer**: Implements IMAP protocol parsing including tagged/untagged responses and literals
- **Command Layer**: Builds IMAP commands and parses command-specific responses
- **Public API**: Exposes the user-facing `ImapClient` class with Promise-based methods

## API Reference

### ImapClient

The main client class for IMAP operations.

#### Static Methods

##### `ImapClient.connect(config: ImapConfig): Promise<ImapClient>`

Creates a new client and connects to the server.

```typescript
const client = await ImapClient.connect({
  imap: {
    host: 'imap.example.com',
    port: 993,
    user: 'user@example.com',
    password: 'password',
    tls: true,
    tlsOptions: { rejectUnauthorized: true }
  }
});
```

#### Instance Methods

##### `end(): Promise<void>`

Closes the connection gracefully by sending LOGOUT command.

```typescript
await client.end();
```

##### `getBoxes(): Promise<MailboxTree>`

Lists all mailboxes on the server.

```typescript
const boxes = await client.getBoxes();
// { INBOX: { attribs: [], delimiter: '/', children: {...} } }
```

##### `openBox(mailboxName: string, readOnly?: boolean): Promise<Mailbox>`

Opens a mailbox for operations.

```typescript
const mailbox = await client.openBox('INBOX');
console.log(mailbox.messages.total);  // Total message count
console.log(mailbox.messages.unseen); // Unseen message count
```

##### `addBox(mailboxName: string): Promise<void>`

Creates a new mailbox.

```typescript
await client.addBox('Archive');
```

##### `delBox(mailboxName: string): Promise<void>`

Deletes a mailbox.

```typescript
await client.delBox('OldFolder');
```

##### `renameBox(oldName: string, newName: string): Promise<void>`

Renames a mailbox.

```typescript
await client.renameBox('OldName', 'NewName');
```

##### `search(criteria: SearchCriteria[]): Promise<number[]>`
##### `search(criteria: SearchCriteria[], fetchOptions: FetchOptions): Promise<Message[]>`

Searches for messages matching the given criteria.

When called without `fetchOptions`, returns an array of UIDs (`number[]`).
When called with `fetchOptions`, returns an array of `Message` objects with fetched data.

```typescript
// Search for UIDs only
const uids = await client.search(['UNSEEN']);
console.log(uids); // [1, 2, 3]

// Search and fetch message data
const messages = await client.search(['UNSEEN'], { bodies: ['HEADER'] });

// Multiple criteria (AND logic)
const messages = await client.search([
  'UNSEEN',
  ['FROM', 'sender@example.com'],
  ['SINCE', new Date('2024-01-01')]
], { bodies: ['HEADER'] });
```

##### `fetch(source: string | number[], fetchOptions: FetchOptions): Promise<Message[]>`

Fetches messages by UID.

```typescript
const messages = await client.fetch([1, 2, 3], {
  bodies: ['HEADER', 'TEXT'],
  struct: true,
  envelope: true
});
```

##### `addFlags(uids: number[], flags: string[]): Promise<void>`

Adds flags to messages.

```typescript
await client.addFlags([1, 2, 3], ['\\Seen', '\\Flagged']);
```

##### `delFlags(uids: number[], flags: string[]): Promise<void>`

Removes flags from messages.

```typescript
await client.delFlags([1, 2, 3], ['\\Seen']);
```

##### `move(uids: number[], destBox: string): Promise<void>`

Moves messages to another mailbox (copies then marks as deleted).

```typescript
await client.move([1, 2, 3], 'Archive');
await client.expunge(); // Remove originals
```

##### `copy(uids: number[], destBox: string): Promise<void>`

Copies messages to another mailbox.

```typescript
await client.copy([1, 2, 3], 'Backup');
```

##### `expunge(): Promise<void>`

Permanently removes messages marked with `\Deleted` flag.

```typescript
await client.expunge();
```

##### `idle(): Promise<IdleController>`

Enters IDLE mode for real-time mailbox notifications (RFC 2177).

```typescript
const idle = await client.idle();

idle.on('exists', (count) => {
  console.log(`New message count: ${count}`);
});

idle.on('expunge', (seqno) => {
  console.log(`Message ${seqno} was expunged`);
});

// Stop IDLE when done
await idle.stop();
```

##### `watch(options?: { pollInterval?: number }): Promise<IdleController>`

Starts watching the mailbox for changes. Uses IDLE if supported, otherwise falls back to polling.

```typescript
const watcher = await client.watch({ pollInterval: 30000 });

watcher.on('exists', (count) => {
  console.log(`New message count: ${count}`);
});

await watcher.stop();
```

##### `poll(): Promise<IdleNotification[]>`

Polls the mailbox for changes using NOOP command. Fallback for servers without IDLE support.

```typescript
const notifications = await client.poll();
for (const n of notifications) {
  if (n.type === 'exists') {
    console.log(`New message count: ${n.count}`);
  }
}
```

##### `openBoxWithQresync(mailboxName, qresync, readOnly?): Promise<QresyncResult>`

Opens a mailbox with QRESYNC for quick resynchronization (RFC 7162).

```typescript
// Save state from previous session
const savedState = {
  uidValidity: box.uidvalidity,
  lastKnownModseq: box.highestModseq
};

// Later session - resync efficiently
const result = await client.openBoxWithQresync('INBOX', savedState);
console.log('Vanished UIDs:', result.vanished);
```

##### `hasCapability(capability: string): boolean`

Checks if the server supports a specific capability.

```typescript
if (client.hasCapability('IDLE')) {
  const idle = await client.idle();
}
```

##### `hasCondstore(): boolean`

Checks if the server supports CONDSTORE extension (RFC 7162) for efficient flag synchronization.

##### `hasQresync(): boolean`

Checks if the server supports QRESYNC extension (RFC 7162) for quick mailbox resynchronization.

##### `getCapabilities(): Set<string>`

Returns all server capabilities.

##### `refreshCapabilities(): Promise<Set<string>>`

Refreshes and returns server capabilities.

#### Properties

- `isConnected: boolean` - Whether the client is currently connected
- `selectedMailbox: Mailbox | null` - The currently selected mailbox

#### Events

- `error` - Emitted when a connection error occurs
- `close` - Emitted when the connection is closed

```typescript
client.on('error', (err) => console.error('Connection error:', err));
client.on('close', () => console.log('Connection closed'));
```


### Configuration

```typescript
interface ImapConfig {
  imap: {
    host: string;           // IMAP server hostname
    port?: number;          // Port (default: 993)
    user: string;           // Username
    password?: string;      // Password (for basic auth)
    xoauth2?: XOAuth2Options; // OAuth2 auth (for Gmail, Microsoft 365)
    tls?: boolean;          // Use TLS (default: true)
    tlsOptions?: TlsOptions;
    authTimeout?: number;   // Auth timeout in ms (default: 30000)
    connTimeout?: number;   // Connection timeout in ms (default: 30000)
  };
}

interface XOAuth2Options {
  user: string;             // User email address
  accessToken: string;      // OAuth2 access token
}

interface TlsOptions {
  rejectUnauthorized?: boolean;
  ca?: string | Buffer | string[] | Buffer[];
  cert?: string | Buffer;
  key?: string | Buffer;
}
```

### OAuth2 Authentication (Gmail, Microsoft 365)

For Gmail and Microsoft 365, basic password authentication is deprecated. Use OAuth2 instead:

```typescript
// Gmail with OAuth2
const client = await ImapClient.connect({
  imap: {
    host: 'imap.gmail.com',
    port: 993,
    user: 'user@gmail.com',
    xoauth2: {
      user: 'user@gmail.com',
      accessToken: 'ya29.your-oauth2-access-token'
    },
    tls: true
  }
});

// Microsoft 365 with OAuth2
const client = await ImapClient.connect({
  imap: {
    host: 'outlook.office365.com',
    port: 993,
    user: 'user@company.onmicrosoft.com',
    xoauth2: {
      user: 'user@company.onmicrosoft.com',
      accessToken: 'eyJ0eXAiOiJKV1Q...'
    },
    tls: true
  }
});
```

### Search Criteria

Supported search criteria:

| Criteria | Description |
|----------|-------------|
| `'ALL'` | All messages |
| `'UNSEEN'` | Unread messages |
| `'SEEN'` | Read messages |
| `'FLAGGED'` | Flagged messages |
| `'UNFLAGGED'` | Unflagged messages |
| `'ANSWERED'` | Answered messages |
| `'DELETED'` | Deleted messages |
| `'DRAFT'` | Draft messages |
| `'NEW'` | New messages |
| `'RECENT'` | Recent messages |
| `['FROM', string]` | From address contains |
| `['TO', string]` | To address contains |
| `['CC', string]` | CC address contains |
| `['SUBJECT', string]` | Subject contains |
| `['BODY', string]` | Body contains |
| `['SINCE', Date]` | Since date |
| `['BEFORE', Date]` | Before date |
| `['ON', Date]` | On date |
| `['LARGER', number]` | Larger than bytes |
| `['SMALLER', number]` | Smaller than bytes |
| `['UID', string]` | UID sequence |
| `['HEADER', field, value]` | Header field contains |

### Fetch Options

```typescript
interface FetchOptions {
  bodies?: string | string[];  // Body parts to fetch
  struct?: boolean;            // Include body structure
  envelope?: boolean;          // Include envelope
  size?: boolean;              // Include size
  markSeen?: boolean;          // Mark as seen when fetching
}
```

#### Body Parts (`bodies` option)

The `bodies` option accepts various formats to fetch different parts of a message:

| Value | Description |
|-------|-------------|
| `'HEADER'` | All message headers |
| `'HEADER.FIELDS (FROM SUBJECT DATE)'` | Specific headers only |
| `'HEADER.FIELDS.NOT (BCC)'` | All headers except specified |
| `'TEXT'` | Message body (without headers) |
| `''` (empty string) | Entire message (headers + body) |
| `'1'` | First MIME part |
| `'1.2'` | Nested MIME part (part 2 of part 1) |
| `'1.HEADER'` | Headers of a specific MIME part |
| `'1.TEXT'` | Body of a specific MIME part |

Example usage:
```typescript
// Fetch only specific headers
const messages = await client.fetch(uids, {
  bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)']
});

// Fetch headers and body text
const messages = await client.fetch(uids, {
  bodies: ['HEADER', 'TEXT']
});

// Fetch entire message
const messages = await client.fetch(uids, {
  bodies: ['']
});
```

### Header Parsing

The library exports a `parseHeaders()` utility for parsing raw header text:

```typescript
import { parseHeaders } from '@dyanet/imap';

// Parse headers from a message part
const headerPart = message.parts.find(p => p.which.includes('HEADER'));
const headers = parseHeaders(headerPart.body.toString());

// Access headers (keys are lowercase)
const subject = headers.get('subject');  // string | string[]
const from = headers.get('from');
const date = headers.get('date');
```

### Standard Flags

- `\Seen` - Message has been read
- `\Answered` - Message has been answered
- `\Flagged` - Message is flagged
- `\Deleted` - Message is marked for deletion
- `\Draft` - Message is a draft

## Extended Capabilities

The library supports several IMAP extensions for advanced functionality. Use `hasCapability()` to check server support before using these features.

### IDLE (RFC 2177)

Real-time mailbox notifications without polling.

```typescript
if (client.hasCapability('IDLE')) {
  const idle = await client.idle();
  
  idle.on('exists', (count) => console.log(`Messages: ${count}`));
  idle.on('expunge', (seqno) => console.log(`Deleted: ${seqno}`));
  idle.on('fetch', ({ seqno, flags }) => console.log(`Flags changed: ${seqno}`));
  
  // Stop when done
  await idle.stop();
}
```

### CONDSTORE (RFC 7162)

Conditional STORE for efficient flag synchronization using MODSEQ values.

```typescript
if (client.hasCondstore()) {
  const mailbox = await client.openBox('INBOX');
  // mailbox.highestModseq contains the current MODSEQ value
  console.log(`Highest MODSEQ: ${mailbox.highestModseq}`);
}
```

### QRESYNC (RFC 7162)

Quick mailbox resynchronization - efficiently sync after reconnection.

```typescript
if (client.hasQresync()) {
  // Save state when disconnecting
  const savedState = {
    uidValidity: mailbox.uidvalidity,
    lastKnownModseq: mailbox.highestModseq
  };
  
  // On reconnect, get only changes
  const result = await client.openBoxWithQresync('INBOX', savedState);
  
  console.log('Expunged UIDs:', result.vanished);
  console.log('Current mailbox:', result.mailbox);
}
```

### Capability Detection

```typescript
// Check specific capability
if (client.hasCapability('IDLE')) { /* ... */ }

// Get all capabilities
const caps = client.getCapabilities();
console.log('Server supports:', [...caps].join(', '));

// Refresh capabilities (after authentication changes)
await client.refreshCapabilities();
```

## Error Handling

The library uses typed error classes for different error categories:

```typescript
import { 
  ImapError,
  ImapProtocolError,
  ImapNetworkError,
  ImapParseError,
  ImapTimeoutError 
} from '@dyanet/imap';

try {
  await client.openBox('NonExistent');
} catch (err) {
  if (err instanceof ImapProtocolError) {
    console.log('Server error:', err.serverResponse);
  } else if (err instanceof ImapNetworkError) {
    console.log('Network error:', err.host, err.port);
  } else if (err instanceof ImapTimeoutError) {
    console.log('Timeout:', err.operation, err.timeoutMs);
  }
}
```

| Error Class | Source | Contains |
|-------------|--------|----------|
| `ImapProtocolError` | Server NO/BAD responses | Server response text, command |
| `ImapNetworkError` | Connection failures | Host, port, underlying error |
| `ImapParseError` | Malformed responses | Raw data that failed to parse |
| `ImapTimeoutError` | Operation timeouts | Operation name, timeout duration |

## Migration from imap-simple

This library is designed as a drop-in replacement for imap-simple:

```typescript
// Before (imap-simple)
import imapSimple from 'imap-simple';
const connection = await imapSimple.connect(config);

// After (@dyanet/imap)
import { ImapClient } from '@dyanet/imap';
const connection = await ImapClient.connect(config);
```

The configuration format and method signatures are compatible with imap-simple.

## Try it against your own mailbox

Two ways in, depending on whether you want to see the library work or see a
real app built on it.

<!-- TODO(video): embed the walkthrough video here once recorded. -->
> 📹 **A video walkthrough is coming.** Until then the written steps below
> are the complete path.

### 1. The example app — this is what we test with

`examples/gmail-viewer/` is a full Express app that signs into Gmail over
OAuth2 and browses your inbox. It is the app we use to exercise this
library against a live server, so it's the fastest way to confirm things
work end to end.

```bash
git clone https://github.com/dyanet/imap.git
cd imap/examples/gmail-viewer
npm install
cp .env.example .env      # then fill in the two Google values below
npm run dev               # builds and starts on http://localhost:3000
```

| Command | What it does |
| -------- | ------------- |
| `npm run dev` | Build then start — the one to use first |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run an already-built `dist/server.js` |
| `npm run verify` | Type-check without emitting |

**Getting the two Google values.** In the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials):
create (or pick) a project → enable the **Gmail API** → **Create
Credentials → OAuth client ID → Web application** → add
`http://localhost:3000/callback` as an authorised redirect URI. Copy the
client ID and secret into `.env` as `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`, then open `http://localhost:3000` and sign in.

Full detail, including deployment, is in
[`examples/gmail-viewer/README.md`](./examples/gmail-viewer/README.md).

**On Outlook:** the example app as shipped is Gmail-only — its OAuth flow
is hard-coded to Google's endpoints. Pointing it at Outlook means
registering an app in Microsoft Entra ID and swapping the authorise/token
URLs and scopes. The library underneath is provider-agnostic; see below.

### 2. The library directly, against Gmail or Outlook

`ImapConfig` takes any host and either a password or XOAUTH2, so no
example app is needed to try a mailbox.

**Gmail** — the quickest route, because Google still accepts app passwords
for IMAP. Turn on 2-Step Verification, then create one at
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords):

```typescript
import { ImapClient } from '@dyanet/imap';

const client = new ImapClient({
  imap: {
    host: 'imap.gmail.com',
    port: 993,
    user: 'you@gmail.com',
    password: 'your-16-char-app-password',  // not your account password
    tls: true,
  },
});

await client.connect();
const box = await client.openBox('INBOX');
console.log(`${box.messages.total} messages`);
await client.end();
```

**Outlook / Microsoft 365** — **app passwords do not work here any more.**
Microsoft finished disabling Basic Authentication for IMAP, POP and SMTP
during 2026; app passwords depend on it, stopped functioning, and cannot be
regenerated. OAuth2 is the only route in, so Outlook needs `xoauth2` rather
than `password`:

```typescript
const client = new ImapClient({
  imap: {
    // Microsoft 365 / work accounts. Personal outlook.com and hotmail.com
    // mailboxes use imap-mail.outlook.com.
    host: 'outlook.office365.com',
    port: 993,
    user: 'you@yourdomain.com',
    xoauth2: {
      user: 'you@yourdomain.com',
      accessToken: entraAccessToken,   // from Microsoft Entra ID
    },
    tls: true,
  },
});
```

Get `entraAccessToken` by registering an application in **Microsoft Entra
ID**, granting it the `IMAP.AccessAsUser.All` delegated permission, and
running the standard authorisation-code flow. See
[Microsoft's IMAP OAuth2 guide](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth).

### 3. No mailbox needed

[**imap-demo.dyanet.workers.dev**](https://imap-demo.dyanet.workers.dev)
runs this library's MIME and RFC 2047 header parsing in the browser — paste
raw headers and watch them decode. Nothing to install and no account
required.

## TypeScript Support

Full TypeScript support with strict mode. All public types are exported:

```typescript
import type {
  ImapConfig,
  TlsOptions,
  Mailbox,
  MailboxTree,
  Message,
  MessagePart,
  SearchCriteria,
  FetchOptions,
  Envelope,
  BodyStructure,
  Address
} from '@dyanet/imap';
```

## Requirements

- Node.js >= 20.0.0

## License

MIT
