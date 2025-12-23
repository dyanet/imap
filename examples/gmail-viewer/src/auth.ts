/**
 * Gmail OAuth2 Authorization CLI
 * 
 * Performs the OAuth2 authorization flow to obtain access tokens for Gmail.
 * Run this first to get your credentials, then use them with the main app.
 */

import { performOAuth2Flow } from './oauth2.js';

async function main(): Promise<void> {
  console.log('📧 Gmail OAuth2 Authorization Tool');
  console.log('===================================\n');

  try {
    const credentials = await performOAuth2Flow();
    
    console.log('✅ Authorization complete!\n');
    console.log('You can now run the Gmail viewer with:');
    console.log('  npm start\n');
    
    // Optionally test the connection
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Test connection now? (Y/n): ', async (answer) => {
      rl.close();
      
      if (answer.toLowerCase() !== 'n') {
        console.log('\nTesting connection...');
        
        try {
          const { ImapClient } = await import('@dyanet/imap');
          
          const client = await ImapClient.connect({
            imap: {
              host: 'imap.gmail.com',
              port: 993,
              user: credentials.user,
              tls: true,
              xoauth2: {
                user: credentials.user,
                accessToken: credentials.accessToken,
              },
            },
          });

          const mailbox = await client.openBox('INBOX');
          console.log(`✓ Connected! INBOX has ${mailbox.messages.total} messages.\n`);
          
          await client.end();
        } catch (err) {
          console.error('❌ Connection test failed:', err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }
    });
  } catch (error) {
    console.error('\n❌ Authorization failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
