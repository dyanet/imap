/**
 * Gmail OAuth2 Token Refresh CLI
 * 
 * Refreshes an expired access token using a stored refresh token.
 */

import { loadCredentialsFromEnv, refreshAccessToken } from './oauth2.js';

// Load .env file
function loadDotEnv(): void {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(process.cwd(), '.env');
    
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch {
    // Ignore
  }
}

async function main(): Promise<void> {
  console.log('🔄 Gmail OAuth2 Token Refresh');
  console.log('=============================\n');

  loadDotEnv();

  const credentials = loadCredentialsFromEnv();
  
  if (!credentials) {
    console.error('❌ No credentials found in environment.');
    console.error('Run "npm run auth" first to set up OAuth2.\n');
    process.exit(1);
  }

  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    console.error('❌ Missing refresh credentials.');
    console.error('Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN\n');
    console.error('Run "npm run auth" to set up OAuth2 with refresh token support.\n');
    process.exit(1);
  }

  try {
    console.log('Refreshing access token...');
    const newToken = await refreshAccessToken(credentials);
    
    console.log('\n✅ Token refreshed successfully!\n');
    console.log('Update your .env file with:\n');
    console.log(`GMAIL_ACCESS_TOKEN=${newToken}\n`);
  } catch (error) {
    console.error('\n❌ Token refresh failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
