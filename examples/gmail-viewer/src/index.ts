/**
 * Gmail Viewer Example
 * 
 * Demonstrates using @dyanet/imap to connect to Gmail and view emails
 * using OAuth2 authentication.
 */

import { ImapClient, parseHeaders } from '@dyanet/imap';
import { loadCredentialsFromEnv, validateCredentials, getValidAccessToken, promptForCredentials, type OAuth2Credentials } from './oauth2.js';

// Load environment variables from .env file if available
loadDotEnv();

/**
 * Simple .env file loader
 * Loads environment variables from .env file in the current directory
 */
function loadDotEnv(): void {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(process.cwd(), '.env');
    
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();
          
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          
          // Only set if not already defined
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch {
    // Ignore errors loading .env
  }
}

/**
 * Formats a date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}


/**
 * Extracts email address from a header value
 * Handles formats like: "Name <email@example.com>" or just "email@example.com"
 */
function extractEmailAddress(headerValue: string): string {
  // Try to extract from angle brackets
  const match = headerValue.match(/<([^>]+)>/);
  if (match) {
    return match[1];
  }
  // Return as-is if no angle brackets
  return headerValue.trim();
}

/**
 * Extracts display name from a header value
 * Handles formats like: "Name <email@example.com>"
 */
function extractDisplayName(headerValue: string): string {
  // Check for angle brackets format
  const match = headerValue.match(/^(.+?)\s*<[^>]+>$/);
  if (match) {
    let name = match[1].trim();
    // Remove surrounding quotes if present
    if ((name.startsWith('"') && name.endsWith('"')) ||
        (name.startsWith("'") && name.endsWith("'"))) {
      name = name.slice(1, -1);
    }
    return name;
  }
  // Return email if no display name
  return extractEmailAddress(headerValue);
}

/**
 * Gets a header value as string from the parsed headers map
 */
function getHeaderValue(headers: Map<string, string | string[]>, key: string): string {
  const value = headers.get(key.toLowerCase());
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
}

/**
 * Email display information
 */
interface EmailInfo {
  subject: string;
  from: string;
  fromEmail: string;
  date: Date;
  uid: number;
}

/**
 * Gets credentials from environment or prompts user interactively
 */
async function getCredentials(): Promise<OAuth2Credentials> {
  // Try loading from environment first
  const envCredentials = loadCredentialsFromEnv();
  
  if (envCredentials && envCredentials.user && envCredentials.accessToken) {
    console.log(`Using credentials from environment for: ${envCredentials.user}\n`);
    return envCredentials;
  }
  
  // Prompt user for credentials interactively
  console.log('No credentials found in environment variables.');
  console.log('Please enter your Gmail OAuth2 credentials:\n');
  
  return promptForCredentials();
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  console.log('📧 Gmail Viewer - @dyanet/imap Example');
  console.log('======================================\n');

  // Get credentials (from env or interactive prompt)
  const credentials = await getCredentials();
  validateCredentials(credentials);

  // Get valid access token (refresh if needed)
  const accessToken = await getValidAccessToken(credentials);

  console.log('Connecting to Gmail...');

  let client: ImapClient | null = null;

  try {
    // Connect to Gmail using OAuth2
    client = await ImapClient.connect({
      imap: {
        host: 'imap.gmail.com',
        port: 993,
        user: credentials.user,
        tls: true,
        xoauth2: {
          user: credentials.user,
          accessToken: accessToken,
        },
        tlsOptions: {
          rejectUnauthorized: true,
        },
      },
    });

    console.log('✓ Connected successfully\n');

    // Open INBOX
    console.log('Opening INBOX...');
    const mailbox = await client.openBox('INBOX');
    console.log(`✓ INBOX opened (${mailbox.messages.total} messages, ${mailbox.messages.unseen} unseen)\n`);

    // Fetch latest 10 emails
    const limit = 10;
    const totalMessages = mailbox.messages.total;

    if (totalMessages === 0) {
      console.log('No emails in INBOX.');
      return;
    }

    // Search for all messages and get UIDs (returns number[] now)
    const allUids = await client.search(['ALL']);
    
    // Get the latest N UIDs (UIDs are sorted ascending, so take from end)
    const latestUids = allUids
      .sort((a, b) => b - a)  // Sort descending (newest first)
      .slice(0, limit);

    if (latestUids.length === 0) {
      console.log('No emails found.');
      return;
    }

    // Fetch headers for these messages
    const messages = await client.fetch(latestUids, {
      bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'],
    });

    // Parse and display emails
    console.log(`Latest ${Math.min(limit, totalMessages)} emails:`);
    console.log('─'.repeat(45) + '\n');

    const emails: EmailInfo[] = [];

    for (const message of messages) {
      // Find the header part
      const headerPart = message.parts.find(p => 
        p.which.toUpperCase().includes('HEADER')
      );

      if (!headerPart) continue;

      // Use the exported parseHeaders utility from @dyanet/imap
      const headers = parseHeaders(
        typeof headerPart.body === 'string' 
          ? headerPart.body 
          : headerPart.body.toString('utf8')
      );
      
      const subject = getHeaderValue(headers, 'subject') || '(No Subject)';
      const fromHeader = getHeaderValue(headers, 'from') || '(Unknown Sender)';
      const dateStr = getHeaderValue(headers, 'date');
      
      const from = extractDisplayName(fromHeader);
      const fromEmail = extractEmailAddress(fromHeader);
      const date = dateStr ? new Date(dateStr) : new Date();

      emails.push({
        subject,
        from,
        fromEmail,
        date,
        uid: message.uid,
      });
    }

    // Sort by date descending (newest first)
    emails.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Display emails
    emails.forEach((email, index) => {
      console.log(`${index + 1}. ${email.subject}`);
      console.log(`   From: ${email.from}${email.from !== email.fromEmail ? ` <${email.fromEmail}>` : ''}`);
      console.log(`   Date: ${formatDate(email.date)}`);
      console.log();
    });

    console.log('─'.repeat(45));

    // Show "more" indicator if there are additional emails
    const remaining = totalMessages - limit;
    if (remaining > 0) {
      console.log(`...and ${remaining} more email${remaining === 1 ? '' : 's'} in INBOX`);
    }

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    
    // Provide helpful error messages
    if (error instanceof Error) {
      if (error.message.includes('Invalid credentials') || 
          error.message.includes('AUTHENTICATIONFAILED')) {
        console.error('\nTip: Your access token may have expired. Try refreshing it.');
        console.error('See README.md for instructions on getting a new token.');
      } else if (error.message.includes('ENOTFOUND') || 
                 error.message.includes('ECONNREFUSED')) {
        console.error('\nTip: Check your network connection and firewall settings.');
      }
    }
    
    process.exit(1);
  } finally {
    // Always close the connection
    if (client) {
      console.log('\nDisconnecting...');
      await client.end();
      console.log('✓ Disconnected');
    }
  }
}

// Run the application
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
