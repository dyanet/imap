# @dyanet/imap

[![CI](https://github.com/dyanet/imap/actions/workflows/ci.yml/badge.svg)](https://github.com/dyanet/imap/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@dyanet/imap.svg)](https://www.npmjs.com/package/@dyanet/imap)
[![npm downloads](https://img.shields.io/npm/dm/@dyanet/imap.svg)](https://www.npmjs.com/package/@dyanet/imap)
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

##### `search(criteria: SearchCriteria[], fetchOptions?: FetchOptions): Promise<Message[]>`

Searches for messages matching the given criteria.

```typescript
// Simple search
const messages = await client.search(['UNSEEN']);

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
  bodies?: string | string[];  // Body parts to fetch ('HEADER', 'TEXT', '')
  struct?: boolean;            // Include body structure
  envelope?: boolean;          // Include envelope
  size?: boolean;              // Include size
  markSeen?: boolean;          // Mark as seen when fetching
}
```

### Standard Flags

- `\Seen` - Message has been read
- `\Answered` - Message has been answered
- `\Flagged` - Message is flagged
- `\Deleted` - Message is marked for deletion
- `\Draft` - Message is a draft

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
