/**
 * @dyanet/imap - A modern, zero-dependency TypeScript IMAP client library
 * 
 * Compatible with imap-simple API for easy migration.
 * 
 * @packageDocumentation
 */

// Export all types
export * from './types/index.js';

// Export encoding utilities (Task 3)
export * from './encoding/index.js';

// Export protocol layer (Task 5)
export * from './protocol/index.js';

// Export command layer (Task 6)
export * from './commands/index.js';

// Export MIME parser (Task 9)
export * from './mime/index.js';

// Export transport layer (Task 11)
export * from './transport/index.js';

// Placeholder exports for future implementations
// These will be implemented in subsequent tasks

// Protocol layer (Task 12)
// export { ImapProtocol } from './protocol/protocol.js';

// Command layer (Tasks 6, 8, 9)
// export { CommandBuilder } from './commands/builder.js';
// export { ResponseParser } from './commands/parser.js';
// export { MimeParser } from './mime/parser.js';

// Public API (Task 13)
export { ImapClient } from './client.js';
