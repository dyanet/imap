/**
 * OAuth2 Authentication Helper for Gmail
 * 
 * This module provides utilities for OAuth2 authentication with Gmail.
 * It supports:
 * - Full OAuth2 authorization code flow with local callback server
 * - Using a pre-obtained access token from environment variables
 * - Token refresh using a refresh token (if configured)
 * - Interactive credential prompting
 */

import * as https from 'https';
import * as http from 'http';
import * as readline from 'readline';
import * as crypto from 'crypto';

/** Default OAuth2 scopes for Gmail IMAP access */
const GMAIL_SCOPES = ['https://mail.google.com/'];

/** Local callback server port */
const CALLBACK_PORT = 3000;

/** Google OAuth2 endpoints */
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * OAuth2 credentials configuration
 */
export interface OAuth2Credentials {
  /** Gmail user email address */
  user: string;
  /** OAuth2 access token */
  accessToken: string;
  /** Optional: Google OAuth2 client ID for token refresh */
  clientId?: string;
  /** Optional: Google OAuth2 client secret for token refresh */
  clientSecret?: string;
  /** Optional: Refresh token for obtaining new access tokens */
  refreshToken?: string;
}

/**
 * Token response from Google OAuth2
 */
interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
}

/**
 * Prompts the user for input via stdin
 */
async function prompt(question: string, hidden: boolean = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      
      let input = '';
      const onData = (char: string) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(input);
        } else if (char === '\u0003') {
          process.exit(0);
        } else if (char === '\u007F' || char === '\b') {
          if (input.length > 0) input = input.slice(0, -1);
        } else {
          input += char;
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Generates a random state parameter for OAuth2 CSRF protection
 */
function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Builds the Google OAuth2 authorization URL
 */
function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges an authorization code for tokens
 */
async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  return new Promise((resolve, reject) => {
    const postData = params.toString();
    const url = new URL(GOOGLE_TOKEN_URL);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(`Token exchange failed: ${response.error_description || response.error}`));
            return;
          }
          resolve(response as TokenResponse);
        } catch (err) {
          reject(new Error(`Failed to parse token response: ${err}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Token request failed: ${err.message}`)));
    req.write(postData);
    req.end();
  });
}

/**
 * Starts a local HTTP server to receive the OAuth2 callback
 */
function startCallbackServer(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`);
      
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
          server.close();
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Invalid State</h1><p>CSRF validation failed.</p></body></html>');
          server.close();
          reject(new Error('Invalid state parameter - possible CSRF attack'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Missing Code</h1><p>No authorization code received.</p></body></html>');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; text-align: center; padding: 50px;">
              <h1>✓ Authorization Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
            </body>
          </html>
        `);
        server.close();
        resolve(code);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(CALLBACK_PORT, () => {
      // Server started
    });

    server.on('error', (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timeout - no callback received within 5 minutes'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Performs the full OAuth2 authorization flow
 * 
 * 1. Starts a local HTTP server for the callback
 * 2. Opens the browser to Google's authorization page
 * 3. Waits for the user to authorize and redirect back
 * 4. Exchanges the authorization code for tokens
 * 
 * @returns Promise resolving to OAuth2 credentials
 */
export async function performOAuth2Flow(): Promise<OAuth2Credentials> {
  console.log('\n🔐 Gmail OAuth2 Authorization\n');
  console.log('This will open your browser to authorize access to your Gmail account.\n');

  // Get client credentials
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log('Enter your Google OAuth2 credentials:');
    console.log('(Create at https://console.cloud.google.com/apis/credentials)\n');
    
    if (!clientId) {
      clientId = await prompt('Client ID: ');
    }
    if (!clientSecret) {
      clientSecret = await prompt('Client Secret: ', true);
    }
  }

  if (!clientId || !clientSecret) {
    throw new Error('Client ID and Client Secret are required');
  }

  const redirectUri = `http://localhost:${CALLBACK_PORT}/callback`;
  const state = generateState();

  // Start callback server
  const codePromise = startCallbackServer(state);

  // Build and display authorization URL
  const authUrl = buildAuthUrl(clientId, redirectUri, state);
  
  console.log('\n📋 Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nWaiting for authorization...\n');

  // Try to open browser automatically
  try {
    const { exec } = require('child_process');
    const platform = process.platform;
    const cmd = platform === 'win32' ? 'start' : platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${cmd} "${authUrl}"`);
  } catch {
    // Ignore - user can open manually
  }

  // Wait for authorization code
  const code = await codePromise;
  console.log('✓ Authorization code received\n');

  // Exchange code for tokens
  console.log('Exchanging code for tokens...');
  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);
  console.log('✓ Tokens received\n');

  // Get user email
  const user = await prompt('Enter your Gmail address: ');
  if (!user || !user.includes('@')) {
    throw new Error('Invalid email address');
  }

  // Display tokens for user to save
  console.log('\n📝 Save these values to your .env file:\n');
  console.log(`GMAIL_USER=${user}`);
  console.log(`GMAIL_ACCESS_TOKEN=${tokens.access_token}`);
  console.log(`GOOGLE_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
  if (tokens.refresh_token) {
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  }
  console.log('');

  return {
    user,
    accessToken: tokens.access_token,
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
  };
}

/**
 * Prompts the user interactively for OAuth2 credentials
 */
export async function promptForCredentials(): Promise<OAuth2Credentials> {
  console.log('Enter your Gmail OAuth2 credentials:');
  console.log('(Get an access token from https://developers.google.com/oauthplayground/)\n');
  
  const user = await prompt('Gmail address: ');
  if (!user || !user.includes('@')) {
    throw new Error('Invalid email address');
  }
  
  const accessToken = await prompt('Access token: ', true);
  if (!accessToken) {
    throw new Error('Access token is required');
  }
  
  const setupRefresh = await prompt('\nSet up token refresh? (y/N): ');
  
  let clientId: string | undefined;
  let clientSecret: string | undefined;
  let refreshToken: string | undefined;
  
  if (setupRefresh.toLowerCase() === 'y') {
    console.log('\nEnter your Google OAuth2 credentials:');
    clientId = await prompt('Client ID: ');
    clientSecret = await prompt('Client Secret: ', true);
    refreshToken = await prompt('Refresh Token: ', true);
  }
  
  console.log('');
  
  return {
    user,
    accessToken,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
    refreshToken: refreshToken || undefined,
  };
}

/**
 * Loads OAuth2 credentials from environment variables
 */
export function loadCredentialsFromEnv(): OAuth2Credentials | null {
  const user = process.env.GMAIL_USER;
  const accessToken = process.env.GMAIL_ACCESS_TOKEN;

  if (!user || !accessToken) {
    return null;
  }

  return {
    user,
    accessToken,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  };
}

/**
 * Refreshes an OAuth2 access token using a refresh token
 */
export async function refreshAccessToken(credentials: OAuth2Credentials): Promise<string> {
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    throw new Error(
      'Token refresh requires clientId, clientSecret, and refreshToken. ' +
      'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables.'
    );
  }

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });

  return new Promise((resolve, reject) => {
    const postData = params.toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      port: 443,
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data) as TokenResponse & { error?: string; error_description?: string };
          if (response.error) {
            reject(new Error(`Token refresh failed: ${response.error_description || response.error}`));
            return;
          }
          if (!response.access_token) {
            reject(new Error('Token refresh response missing access_token'));
            return;
          }
          resolve(response.access_token);
        } catch (err) {
          reject(new Error(`Failed to parse token response: ${err}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Token refresh request failed: ${err.message}`)));
    req.write(postData);
    req.end();
  });
}

/**
 * Gets a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(
  credentials: OAuth2Credentials,
  forceRefresh: boolean = false
): Promise<string> {
  if (forceRefresh && credentials.refreshToken) {
    return refreshAccessToken(credentials);
  }
  return credentials.accessToken;
}

/**
 * Validates that required credentials are present
 */
export function validateCredentials(credentials: OAuth2Credentials | null): asserts credentials is OAuth2Credentials {
  if (!credentials) {
    throw new Error(
      'Missing required environment variables.\n' +
      'Please set GMAIL_USER and GMAIL_ACCESS_TOKEN.\n' +
      'See .env.example for details.'
    );
  }

  if (!credentials.user) {
    throw new Error('GMAIL_USER environment variable is required');
  }

  if (!credentials.accessToken) {
    throw new Error('GMAIL_ACCESS_TOKEN environment variable is required');
  }
}
