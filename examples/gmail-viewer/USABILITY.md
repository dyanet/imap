# Usability Notes and Observations

This document captures usability observations, potential issues, and suggestions discovered while building the Gmail viewer example application.

## API Ergonomics

### Positive Observations

1. **Clean Configuration Interface**: The `ImapConfig` interface is well-structured and imap-simple compatible. The `xoauth2` option makes OAuth2 authentication straightforward.

2. **Promise-Based API**: All methods return Promises, making async/await usage natural and clean.

3. **TypeScript Support**: Full TypeScript definitions provide excellent IDE support and catch errors at compile time.

4. **Mailbox Information**: The `openBox()` method returns useful mailbox statistics (total, unseen counts) immediately.

### Areas for Improvement

1. **Search Result Type**: The `search()` method returns `Message[]` but when called without `fetchOptions`, the messages only contain UIDs. Consider:
   - Returning `number[]` (UIDs) when no fetchOptions provided
   - Or documenting this behavior more clearly
   - Current workaround: Access `message.uid` from the result

2. **Header Parsing Convenience**: While the library correctly fetches headers, parsing them requires manual work:
   - Headers come as raw text in `message.parts[].body`
   - No built-in header parsing utility exposed
   - Suggestion: Export a `parseHeaders()` utility function

3. **Date Handling**: Message dates require manual parsing from header strings:
   - The `message.attributes.date` exists but may not always be populated
   - Suggestion: Ensure date is always parsed when headers are fetched

4. **Fetch Options Documentation**: The `bodies` option accepts various formats but documentation could be clearer:
   - `'HEADER'` - all headers
   - `'HEADER.FIELDS (FROM SUBJECT DATE)'` - specific headers
   - `'TEXT'` - body text
   - `'1'`, `'2'` - specific MIME parts

## Potential Issues

### Not Yet Tested (Requires Real Gmail Account)

The following scenarios need real-world testing:

1. **Token Expiration Handling**: Access tokens expire after 1 hour. The library should:
   - Detect authentication failures
   - Allow token refresh callbacks
   - Current: User must handle refresh externally

2. **Large Mailbox Performance**: Behavior with mailboxes containing thousands of messages:
   - Search performance
   - Memory usage during fetch

3. **Special Characters**: Email subjects/addresses with:
   - Unicode characters
   - Encoded words (RFC 2047)
   - Very long subjects

4. **Gmail-Specific Labels**: Gmail uses labels instead of traditional folders:
   - `[Gmail]/All Mail`
   - `[Gmail]/Sent Mail`
   - Custom labels

## Suggestions for Future Enhancements

1. **High-Level Email Interface**: Consider adding a convenience wrapper:
   ```typescript
   interface Email {
     uid: number;
     subject: string;
     from: { name: string; email: string };
     to: { name: string; email: string }[];
     date: Date;
     body?: string;
     attachments?: Attachment[];
   }
   
   // Usage: const emails = await client.getEmails('INBOX', { limit: 10 });
   ```

2. **Connection Events**: More granular connection state events:
   - `'connecting'`
   - `'authenticating'`
   - `'ready'`
   - `'reconnecting'`

3. **Retry Logic**: Built-in retry for transient failures:
   - Network timeouts
   - Server busy responses

4. **Streaming Support**: For large attachments:
   - Stream-based fetch for memory efficiency
   - Progress callbacks

## GitHub Issues to Create

Based on this analysis, the following issues should be created:

- [ ] **Enhancement**: Export header parsing utilities
- [ ] **Enhancement**: Add convenience method for fetching emails with parsed headers
- [ ] **Documentation**: Improve fetch options documentation with examples
- [ ] **Enhancement**: Consider token refresh callback support in config

## Test Results

- ✅ TypeScript compilation successful
- ✅ Package imports work correctly
- ⏳ Real Gmail connection (requires OAuth2 setup)
- ⏳ Email listing functionality (requires OAuth2 setup)

## Notes

This example was built to demonstrate the library's capabilities and identify real-world usage patterns. The library successfully handles the core IMAP operations needed for a Gmail client. The suggestions above are enhancements that would improve developer experience but are not blocking issues.
