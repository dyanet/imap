/**
 * Gmail Viewer - Express Web Application
 * 
 * A secure web-based Gmail viewer using @dyanet/imap with OAuth2 authentication.
 */

import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import crypto from 'crypto';
import { ConfigManager, SecretsManagerLoader, EnvironmentLoader, EnvFileLoader } from '@dyanet/config-aws';
import https from 'https';
import { z } from 'zod';
import { ImapClient, parseHeaders, type SearchCriteria, type IdleController, type IdleNotification } from '@dyanet/imap';

// Extend session data
declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
    user?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;  // Unix timestamp when access token expires
    lastOAuthError?: string;  // Last OAuth error for debugging
  }
}

// Store active IDLE sessions (keyed by session ID)
const activeIdleSessions = new Map<string, {
  client: ImapClient;
  controller: IdleController;
  startTime: Date;
  mailbox: string;
  notifications: IdleNotification[];
}>();

// Define your configuration schema
const schema = z.object({
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  SESSION_SECRET: z.string(),
  BASE_URL: z.string(),
  PORT: z.coerce.number().default(3000),
});

// Create and load configuration
/* Three from the environment */
const CONFIG_SSM_PREFIX = process.env.CONFIG_SSM_PREFIX || '/mail-example';
const NODE_ENV = process.env.NODE_ENV || 'development';
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ca-central-1';
const configManager = new ConfigManager({
  loaders: [
    new EnvFileLoader({ paths: ['.env', '.env.local'], override: true }),
    new EnvironmentLoader(),
    new SecretsManagerLoader({ secretName: '/mail-example/config' }),
  ],
  // Schema may have different Zod typings across package boundaries; cast to any
  schema: schema as any,
  // Disable automatic validation during load to avoid throwing here; we'll rely on schema in future
  validateOnLoad: false,
  precedence: 'aws-first', // AWS sources override local
});
// Load configuration before using it (top-level await is supported in ESM)
await configManager.load();
const config = configManager.getAll() as Record<string, any>;

// Configuration
const CLIENT_ID = config.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = config.GOOGLE_CLIENT_SECRET;
const PORT = config.PORT;
const SESSION_SECRET = config.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const BASE_URL= config.BASE_URL || `http://localhost:${config.PORT}`;
const CALLBACK_PATH = '/callback';
const GMAIL_SCOPES = ['https://mail.google.com/'];

// Google OAuth2 endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));

// Session configuration
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
  },
}));

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Generate a secure random state for OAuth2 CSRF protection
 */
function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Build Google OAuth2 authorization URL
 */
function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${BASE_URL}${CALLBACK_PATH}`,
    response_type: 'code',
    scope: [...GMAIL_SCOPES, 'email'].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}> {
  const params = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: `${BASE_URL}${CALLBACK_PATH}`,
    grant_type: 'authorization_code',
  });

  console.log('[OAuth2] Exchanging authorization code for tokens...');
  console.log('[OAuth2] Redirect URI:', `${BASE_URL}${CALLBACK_PATH}`);
  console.log('[OAuth2] Client ID:', CLIENT_ID ? `${CLIENT_ID.substring(0, 20)}...` : 'NOT SET');
  console.log('[OAuth2] Client Secret:', CLIENT_SECRET ? `${CLIENT_SECRET.substring(0, 8)}... (length: ${CLIENT_SECRET.length})` : 'NOT SET');
  console.log('[OAuth2] Client Secret starts with GOCSPX-:', CLIENT_SECRET?.startsWith('GOCSPX-'));

  return new Promise((resolve, reject) => {
    const postData = params.toString();
    const url = new URL(GOOGLE_TOKEN_URL);

    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log('[OAuth2] Token exchange response status:', res.statusCode);
        
        if (res.statusCode !== 200) {
          const errorMsg = `Token exchange failed: HTTP ${res.statusCode} - ${data}`;
          console.error('[OAuth2] Error:', errorMsg);
          reject(new Error(errorMsg));
          return;
        }
        try {
          const response = JSON.parse(data);
          if (response.error) {
            const errorMsg = response.error_description || response.error;
            console.error('[OAuth2] Token error:', errorMsg);
            reject(new Error(errorMsg));
            return;
          }
          console.log('[OAuth2] Token exchange successful, expires_in:', response.expires_in);
          resolve({
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            expiresIn: response.expires_in,
          });
        } catch (err) {
          console.error('[OAuth2] Failed to parse token response:', err);
          reject(new Error('Failed to parse token response'));
        }
      });
    });

    req.on('error', err => {
      console.error('[OAuth2] Network error during token exchange:', err);
      reject(err);
    });
    req.write(postData);
    req.end();
  });
}

/**
 * Get user email from Google
 */
async function getUserEmail(accessToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(GOOGLE_USERINFO_URL);

    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data || 'Unauthorized'}`));
          return;
        }
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(response.error.message || 'Failed to get user info'));
            return;
          }
          resolve(response.email);
        } catch (err) {
          reject(new Error('Failed to parse user info'));
        }
      });
    });

    req.on('error', err => reject(err));
    req.end();
  });
}

/**
 * Refresh access token with retry and exponential backoff
 */
async function refreshAccessToken(refreshToken: string, retryCount = 0): Promise<{ accessToken: string; expiresIn?: number }> {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000; // 1 second

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  console.log(`[OAuth2] Refreshing access token (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);

  return new Promise((resolve, reject) => {
    const postData = params.toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      port: 443,
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log('[OAuth2] Token refresh response status:', res.statusCode);
        
        // Check for HTTP errors
        if (res.statusCode !== 200) {
          const errorMsg = `Token refresh failed: HTTP ${res.statusCode} - ${data}`;
          console.error('[OAuth2] Error:', errorMsg);
          
          // Retry on 5xx errors or network issues
          if (res.statusCode && res.statusCode >= 500 && retryCount < MAX_RETRIES) {
            const delay = BASE_DELAY * Math.pow(2, retryCount);
            console.log(`[OAuth2] Retrying in ${delay}ms...`);
            setTimeout(() => {
              refreshAccessToken(refreshToken, retryCount + 1)
                .then(resolve)
                .catch(reject);
            }, delay);
            return;
          }
          
          reject(new Error(errorMsg));
          return;
        }
        
        try {
          const response = JSON.parse(data);
          if (response.error) {
            const errorMsg = response.error_description || response.error;
            console.error('[OAuth2] Token refresh error:', errorMsg);
            reject(new Error(errorMsg));
            return;
          }
          console.log('[OAuth2] Token refresh successful, expires_in:', response.expires_in);
          resolve({
            accessToken: response.access_token,
            expiresIn: response.expires_in,
          });
        } catch (err) {
          console.error('[OAuth2] Failed to parse refresh response:', err);
          reject(new Error('Failed to refresh token'));
        }
      });
    });

    req.on('error', err => {
      console.error('[OAuth2] Network error during token refresh:', err);
      
      // Retry on network errors
      if (retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`[OAuth2] Retrying in ${delay}ms...`);
        setTimeout(() => {
          refreshAccessToken(refreshToken, retryCount + 1)
            .then(resolve)
            .catch(reject);
        }, delay);
        return;
      }
      
      reject(err);
    });
    req.write(postData);
    req.end();
  });
}

/**
 * Authentication middleware
 */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.accessToken || !req.session.user) {
    res.redirect('/login');
    return;
  }
  next();
}

/**
 * Create a connected IMAP client with the current user's OAuth token
 */
async function createImapClient(user: string, accessToken: string): Promise<ImapClient> {
  return ImapClient.connect({
    imap: {
      host: 'imap.gmail.com',
      port: 993,
      user,
      tls: true,
      xoauth2: { user, accessToken },
      tlsOptions: {
        servername: 'imap.gmail.com',
      },
    },
  });
}

/**
 * Fetch emails from Gmail
 * 
 * Handles:
 * - RFC 2047 encoded headers (via parseHeaders)
 * - Missing headers gracefully
 * - Invalid dates with fallback
 * - Unicode in sender names
 */
async function fetchEmails(user: string, accessToken: string, limit: number = 20): Promise<Array<{
  uid: number;
  subject: string;
  from: string;
  date: Date | null;
  flags: string[];
}>> {
  console.log('[IMAP] Creating client for:', user);
  const client = await createImapClient(user, accessToken);
  console.log('[IMAP] Client connected successfully');

  try {
    console.log('[IMAP] Opening INBOX...');
    await client.openBox('INBOX');
    console.log('[IMAP] INBOX opened');
    
    const uids = await client.search(['ALL']);
    console.log(`[IMAP] Found ${uids.length} messages`);
    
    const latestUids = uids.sort((a, b) => b - a).slice(0, limit);

    if (latestUids.length === 0) {
      console.log('[IMAP] No messages to fetch');
      return [];
    }

    console.log(`[IMAP] Fetching ${latestUids.length} messages...`);
    const messages = await client.fetch(latestUids, {
      bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'],
    });
    console.log(`[IMAP] Fetched ${messages.length} messages`);

    return messages.map(msg => {
      const headerPart = msg.parts.find(p => p.which.toUpperCase().includes('HEADER'));
      const headers = headerPart 
        ? parseHeaders(typeof headerPart.body === 'string' ? headerPart.body : headerPart.body.toString())
        : new Map();

      // Extract headers with proper handling for arrays and missing values
      const fromHeader = headers.get('from');
      const subjectHeader = headers.get('subject');
      const dateHeader = headers.get('date');

      // Parse subject - handle missing or empty subjects
      const rawSubject = Array.isArray(subjectHeader) ? subjectHeader[0] : subjectHeader;
      const subject = rawSubject?.trim() || '(No Subject)';

      // Parse from - handle missing sender
      const rawFrom = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
      const from = rawFrom?.trim() || '(Unknown Sender)';

      // Parse date - handle invalid dates gracefully
      const rawDate = Array.isArray(dateHeader) ? dateHeader[0] : dateHeader;
      let date: Date | null = null;
      if (rawDate) {
        const parsedDate = new Date(rawDate);
        // Check if date is valid (not NaN)
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate;
        }
      }

      return {
        uid: msg.uid,
        subject,
        from,
        date,
        flags: msg.attributes.flags || [],
      };
    }).sort((a, b) => {
      // Sort by date descending, with null dates at the end
      if (a.date === null && b.date === null) return 0;
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return b.date.getTime() - a.date.getTime();
    });
  } finally {
    console.log('[IMAP] Closing connection...');
    await client.end();
    console.log('[IMAP] Connection closed');
  }
}

// HTML Templates
const baseTemplate = (title: string, content: string, user?: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Gmail Viewer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; }
    .header { background: #1a73e8; color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 1.5rem; }
    .header a { color: white; text-decoration: none; }
    .container { max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 2rem; margin-bottom: 1rem; }
    .btn { display: inline-block; padding: 0.75rem 1.5rem; background: #1a73e8; color: white; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; font-size: 1rem; }
    .btn:hover { background: #1557b0; }
    .btn-danger { background: #dc3545; }
    .btn-danger:hover { background: #c82333; }
    .email-list { list-style: none; }
    .email-item { padding: 1rem; border-bottom: 1px solid #eee; display: flex; gap: 1rem; }
    .email-item:last-child { border-bottom: none; }
    .email-item:hover { background: #f8f9fa; }
    .email-unread { font-weight: bold; }
    .email-subject { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .email-from { color: #666; width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .email-date { color: #999; width: 150px; text-align: right; }
    .center { text-align: center; }
    .error { color: #dc3545; padding: 1rem; background: #f8d7da; border-radius: 4px; margin-bottom: 1rem; }
    .info { color: #0c5460; padding: 1rem; background: #d1ecf1; border-radius: 4px; margin-bottom: 1rem; }
    .form-row { display: flex; gap: 0.75rem; margin-top: 0.75rem; flex-wrap: wrap; }
    .form-row label { display: flex; flex-direction: column; font-size: 0.9rem; color: #333; flex: 1 1 180px; }
    .form-row input, .form-row textarea { padding: 0.55rem 0.65rem; border: 1px solid #ddd; border-radius: 4px; margin-top: 0.35rem; font-size: 0.95rem; }
    pre { background: #f8f9fa; border-radius: 6px; padding: 1rem; overflow-x: auto; margin-top: 0.75rem; border: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📧 Gmail Viewer</h1>
    ${user ? `<div style="display: flex; gap: 0.75rem; align-items: center;">
      <span>${user}</span>
      <a href="/inbox">Inbox</a>
      <a href="/diagnostics">Diagnostics</a>
      <a href="/logout">Logout</a>
    </div>` : ''}
  </div>
  <div class="container">${content}</div>
</body>
</html>
`;

// Routes
app.get('/', (req, res) => {
  if (req.session.accessToken) {
    res.redirect('/inbox');
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.send(baseTemplate('Setup Required', `
      <div class="card">
        <h2>Setup Required</h2>
        <p class="info" style="margin-top: 1rem;">
          Please set the following environment variables:<br><br>
          <code>GOOGLE_CLIENT_ID</code> - Your Google OAuth2 Client ID<br>
          <code>GOOGLE_CLIENT_SECRET</code> - Your Google OAuth2 Client Secret<br><br>
          Get these from <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a>
        </p>
      </div>
    `));
    return;
  }

  res.send(baseTemplate('Login', `
    <div class="card center">
      <h2>Welcome to Gmail Viewer</h2>
      <p style="margin: 1.5rem 0; color: #666;">Sign in with your Google account to view your emails.</p>
      <a href="/auth" class="btn">Sign in with Google</a>
    </div>
  `));
});

app.get('/auth', (req, res) => {
  const state = generateState();
  req.session.oauthState = state;
  res.redirect(buildAuthUrl(state));
});

app.get(CALLBACK_PATH, async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    res.send(baseTemplate('Error', `
      <div class="card">
        <div class="error">Authorization failed: ${error}</div>
        <a href="/login" class="btn">Try Again</a>
      </div>
    `));
    return;
  }

  // Verify state to prevent CSRF
  if (!state || state !== req.session.oauthState) {
    res.status(403).send(baseTemplate('Error', `
      <div class="card">
        <div class="error">Invalid state parameter. Possible CSRF attack.</div>
        <a href="/login" class="btn">Try Again</a>
      </div>
    `));
    return;
  }

  delete req.session.oauthState;

  if (!code || typeof code !== 'string') {
    res.send(baseTemplate('Error', `
      <div class="card">
        <div class="error">No authorization code received.</div>
        <a href="/login" class="btn">Try Again</a>
      </div>
    `));
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await getUserEmail(tokens.accessToken);

    req.session.accessToken = tokens.accessToken;
    req.session.refreshToken = tokens.refreshToken;
    req.session.user = email;
    // Store token expiry time (current time + expires_in seconds)
    if (tokens.expiresIn) {
      req.session.tokenExpiry = Date.now() + (tokens.expiresIn * 1000);
    }
    delete req.session.lastOAuthError;

    console.log('[OAuth2] Authentication successful for:', email);
    res.redirect('/inbox');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    req.session.lastOAuthError = errorMsg;
    console.error('[OAuth2] Authentication failed:', errorMsg);
    res.send(baseTemplate('Error', `
      <div class="card">
        <div class="error">Failed to authenticate: ${escapeHtml(errorMsg)}</div>
        <a href="/login" class="btn">Try Again</a>
      </div>
    `));
  }
});

app.get('/inbox', requireAuth, async (req, res) => {
  try {
    console.log('[Inbox] Fetching emails for:', req.session.user);
    const emails = await fetchEmails(req.session.user!, req.session.accessToken!);
    console.log(`[Inbox] Fetched ${emails.length} emails`);

    const emailListHtml = emails.length > 0
      ? `<ul class="email-list">${emails.map(email => `
          <li class="email-item ${email.flags.includes('\\Seen') ? '' : 'email-unread'}">
            <span class="email-from" title="${escapeHtml(email.from)}">${escapeHtml(truncateString(extractName(email.from), 30))}</span>
            <span class="email-subject" title="${escapeHtml(email.subject)}">${escapeHtml(truncateString(email.subject, 80))}</span>
            <span class="email-date">${formatDate(email.date)}</span>
          </li>
        `).join('')}</ul>`
      : '<p class="center" style="padding: 2rem; color: #666;">No emails found in your inbox.</p>';

    res.send(baseTemplate('Inbox', `
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h2>Inbox</h2>
          <a href="/inbox" class="btn">Refresh</a>
        </div>
        ${emailListHtml}
      </div>
    `, req.session.user));
  } catch (err) {
    console.error('[Inbox] Error fetching emails:', err);
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    const isAuthError = err instanceof Error && 
      (err.message.includes('AUTHENTICATIONFAILED') || 
       err.message.includes('Invalid credentials') ||
       err.message.includes('XOAUTH2'));
    
    // Try to refresh token if authentication failed
    if (req.session.refreshToken && isAuthError) {
      try {
        console.log('[Inbox] Attempting token refresh...');
        const refreshResult = await refreshAccessToken(req.session.refreshToken);
        req.session.accessToken = refreshResult.accessToken;
        // Update token expiry
        if (refreshResult.expiresIn) {
          req.session.tokenExpiry = Date.now() + (refreshResult.expiresIn * 1000);
        }
        delete req.session.lastOAuthError;
        console.log('[Inbox] Token refresh successful, redirecting...');
        res.redirect('/inbox');
        return;
      } catch (refreshErr) {
        const refreshErrorMsg = refreshErr instanceof Error ? refreshErr.message : 'Unknown error';
        console.error('[Inbox] Token refresh failed:', refreshErrorMsg);
        req.session.lastOAuthError = refreshErrorMsg;
      }
    }

    // Determine error type for better user feedback
    const isNetworkError = err instanceof Error && 
      (err.message.includes('ECONNREFUSED') || 
       err.message.includes('ETIMEDOUT') ||
       err.message.includes('ENOTFOUND') ||
       err.message.includes('network'));
    
    const errorTitle = isAuthError 
      ? 'Authentication Failed' 
      : isNetworkError 
        ? 'Connection Error' 
        : 'Error';
    
    const errorDescription = isAuthError
      ? 'Your session has expired or is invalid. Please re-authenticate.'
      : isNetworkError
        ? 'Unable to connect to Gmail. Please check your internet connection.'
        : `Failed to fetch emails: ${escapeHtml(errorMsg)}`;

    res.send(baseTemplate('Error', `
      <div class="card">
        <h2>${errorTitle}</h2>
        <div class="error" style="margin-top: 1rem;">${errorDescription}</div>
        <div style="margin-top: 1.5rem;">
          <a href="/inbox" class="btn">Retry</a>
          ${isAuthError ? `<a href="/auth" class="btn" style="margin-left: 0.5rem;">Re-authenticate</a>` : ''}
          <a href="/logout" class="btn btn-danger" style="margin-left: 0.5rem;">Logout</a>
        </div>
      </div>
    `, req.session.user));
  }
});

app.get('/diagnostics', requireAuth, (req, res) => {
  res.send(baseTemplate('Diagnostics', renderDiagnosticsPage(), req.session.user));
});

// JSON endpoint for mailbox list (used by dropdown)
app.get('/diagnostics/mailboxes-json', requireAuth, async (req, res) => {
  try {
    const client = await createImapClient(req.session.user!, req.session.accessToken!);
    try {
      const boxes = await client.getBoxes();
      
      // Flatten the tree into a list of mailbox names with attributes
      const mailboxes: { name: string; attributes: string[] }[] = [];
      
      function flattenTree(tree: any, prefix: string = '') {
        for (const [name, info] of Object.entries(tree)) {
          const fullName = prefix ? `${prefix}/${name}` : name;
          const boxInfo = info as { attribs: string[]; delimiter: string; children?: any };
          mailboxes.push({
            name: fullName,
            attributes: boxInfo.attribs || []
          });
          if (boxInfo.children) {
            flattenTree(boxInfo.children, fullName);
          }
        }
      }
      
      flattenTree(boxes);
      
      // Sort: INBOX first, then [Gmail] folders, then others alphabetically
      mailboxes.sort((a, b) => {
        if (a.name === 'INBOX') return -1;
        if (b.name === 'INBOX') return 1;
        if (a.name.startsWith('[Gmail]') && !b.name.startsWith('[Gmail]')) return -1;
        if (!a.name.startsWith('[Gmail]') && b.name.startsWith('[Gmail]')) return 1;
        return a.name.localeCompare(b.name);
      });
      
      res.json({ success: true, mailboxes });
    } finally {
      await client.end();
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    res.json({ success: false, error: errorMsg });
  }
});

app.post('/diagnostics/:action', requireAuth, async (req, res) => {
  try {
    const result = await handleDiagnosticsAction(req.params.action, req);
    res.send(baseTemplate('Diagnostics', renderDiagnosticsPage(result), req.session.user));
  } catch (err) {
    res.send(baseTemplate('Diagnostics', renderDiagnosticsPage({
      title: 'Unexpected error',
      success: false,
      details: err instanceof Error ? err.message : 'Unknown error',
    }), req.session.user));
  }
});

// SSE endpoint for IDLE notifications
app.get('/diagnostics/idle/stream', requireAuth, async (req, res) => {
  const sessionId = req.sessionID;
  const mailbox = (req.query.mailbox as string) || 'INBOX';
  const timeout = parseInt(req.query.timeout as string) || 30;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', mailbox, timeout })}\n\n`);

  try {
    // Check if there's already an active IDLE session
    const existingSession = activeIdleSessions.get(sessionId);
    if (existingSession) {
      try {
        await existingSession.controller.stop();
        await existingSession.client.end();
      } catch {
        // Ignore cleanup errors
      }
      activeIdleSessions.delete(sessionId);
    }

    // Create IMAP client
    const client = await createImapClient(req.session.user!, req.session.accessToken!);
    
    // Check IDLE capability
    const capabilities = await client.refreshCapabilities();
    const hasIdle = client.hasCapability('IDLE');
    
    if (!hasIdle) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Server does not support IDLE extension' })}\n\n`);
      await client.end();
      res.end();
      return;
    }

    // Open mailbox
    await client.openBox(mailbox);
    res.write(`data: ${JSON.stringify({ type: 'mailbox_opened', mailbox })}\n\n`);

    // Start IDLE
    const controller = await client.idle();
    
    // Store session
    const idleSession = {
      client,
      controller,
      startTime: new Date(),
      mailbox,
      notifications: [] as IdleNotification[],
    };
    activeIdleSessions.set(sessionId, idleSession);

    res.write(`data: ${JSON.stringify({ type: 'idle_started', mailbox })}\n\n`);

    // Set up notification handlers
    controller.on('exists', (count) => {
      const notification = { type: 'exists', count, timestamp: new Date().toISOString() };
      idleSession.notifications.push({ type: 'exists', count, raw: `* ${count} EXISTS` });
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    });

    controller.on('expunge', (seqno) => {
      const notification = { type: 'expunge', seqno, timestamp: new Date().toISOString() };
      idleSession.notifications.push({ type: 'expunge', seqno, raw: `* ${seqno} EXPUNGE` });
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    });

    controller.on('fetch', (data) => {
      const notification = { type: 'fetch', ...data, timestamp: new Date().toISOString() };
      idleSession.notifications.push({ type: 'fetch', seqno: data.seqno, flags: data.flags, uid: data.uid, raw: `* FETCH` });
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    });

    controller.on('recent', (count) => {
      const notification = { type: 'recent', count, timestamp: new Date().toISOString() };
      idleSession.notifications.push({ type: 'recent', count, raw: `* ${count} RECENT` });
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    });

    controller.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    });

    controller.on('end', () => {
      res.write(`data: ${JSON.stringify({ type: 'idle_ended' })}\n\n`);
      activeIdleSessions.delete(sessionId);
      res.end();
    });

    // Set up timeout
    const timeoutMs = timeout * 1000;
    const timeoutId = setTimeout(async () => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'timeout', message: `IDLE session timed out after ${timeout} seconds` })}\n\n`);
        await controller.stop();
        await client.end();
        activeIdleSessions.delete(sessionId);
      } catch {
        // Ignore cleanup errors
      }
      res.end();
    }, timeoutMs);

    // Handle client disconnect
    req.on('close', async () => {
      clearTimeout(timeoutId);
      try {
        if (controller.isActive) {
          await controller.stop();
        }
        await client.end();
      } catch {
        // Ignore cleanup errors
      }
      activeIdleSessions.delete(sessionId);
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', message: errorMsg })}\n\n`);
    res.end();
  }
});

// Stop IDLE endpoint
app.post('/diagnostics/idle/stop', requireAuth, async (req, res) => {
  const sessionId = req.sessionID;
  const session = activeIdleSessions.get(sessionId);
  
  if (!session) {
    res.json({ success: false, message: 'No active IDLE session' });
    return;
  }

  try {
    await session.controller.stop();
    await session.client.end();
    activeIdleSessions.delete(sessionId);
    res.json({ success: true, message: 'IDLE session stopped', notifications: session.notifications });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    res.json({ success: false, message: errorMsg });
  }
});

// OAuth2 Debug endpoint (development mode only)
app.get('/debug/oauth', (req, res) => {
  // Only allow in development mode
  if (NODE_ENV === 'production') {
    res.status(404).send('Not found');
    return;
  }

  const tokenExpiry = req.session.tokenExpiry;
  const now = Date.now();
  const expiresIn = tokenExpiry ? Math.max(0, Math.floor((tokenExpiry - now) / 1000)) : null;
  const isExpired = tokenExpiry ? now > tokenExpiry : null;

  const debugInfo = {
    authenticated: !!req.session.accessToken,
    user: req.session.user || null,
    hasAccessToken: !!req.session.accessToken,
    hasRefreshToken: !!req.session.refreshToken,
    tokenExpiry: tokenExpiry ? new Date(tokenExpiry).toISOString() : null,
    expiresInSeconds: expiresIn,
    isExpired,
    lastError: req.session.lastOAuthError || null,
    config: {
      baseUrl: BASE_URL,
      callbackPath: CALLBACK_PATH,
      redirectUri: `${BASE_URL}${CALLBACK_PATH}`,
      scopes: GMAIL_SCOPES,
      hasClientId: !!CLIENT_ID,
      hasClientSecret: !!CLIENT_SECRET,
    },
  };

  res.send(baseTemplate('OAuth Debug', `
    <div class="card">
      <h2>OAuth2 Debug Information</h2>
      <p class="info" style="margin-top: 1rem;">This endpoint is only available in development mode.</p>
      
      <h3 style="margin-top: 1.5rem;">Session Status</h3>
      <pre>${escapeHtml(JSON.stringify({
        authenticated: debugInfo.authenticated,
        user: debugInfo.user,
        hasAccessToken: debugInfo.hasAccessToken,
        hasRefreshToken: debugInfo.hasRefreshToken,
      }, null, 2))}</pre>
      
      <h3 style="margin-top: 1rem;">Token Status</h3>
      <pre>${escapeHtml(JSON.stringify({
        tokenExpiry: debugInfo.tokenExpiry,
        expiresInSeconds: debugInfo.expiresInSeconds,
        isExpired: debugInfo.isExpired,
      }, null, 2))}</pre>
      
      ${debugInfo.lastError ? `
        <h3 style="margin-top: 1rem;">Last Error</h3>
        <div class="error">${escapeHtml(debugInfo.lastError)}</div>
      ` : ''}
      
      <h3 style="margin-top: 1rem;">Configuration</h3>
      <pre>${escapeHtml(JSON.stringify(debugInfo.config, null, 2))}</pre>
      
      <div style="margin-top: 1.5rem;">
        ${debugInfo.authenticated 
          ? '<a href="/inbox" class="btn">Go to Inbox</a>' 
          : '<a href="/login" class="btn">Login</a>'}
        <a href="/debug/oauth" class="btn" style="margin-left: 0.5rem;">Refresh</a>
      </div>
    </div>
  `, req.session.user));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Helper functions
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*<[^>]+>$/);
  if (match) {
    let name = match[1].trim();
    if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
      name = name.slice(1, -1);
    }
    return name;
  }
  return from.replace(/<[^>]+>/, '').trim() || from;
}

/**
 * Truncates a string to a maximum length with ellipsis
 * Handles Unicode characters properly
 */
function truncateString(str: string, maxLength: number): string {
  if (!str) return str;
  
  // Use Array.from to properly handle Unicode characters
  const chars = Array.from(str);
  if (chars.length <= maxLength) {
    return str;
  }
  
  return chars.slice(0, maxLength - 1).join('') + '…';
}

function formatDate(date: Date | null): string {
  // Handle null/invalid dates
  if (!date) {
    return '(No date)';
  }
  
  // Double-check for invalid Date objects
  if (isNaN(date.getTime())) {
    return '(Invalid date)';
  }
  
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  
  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type DiagnosticResult = {
  title: string;
  success: boolean;
  details: any;
};

function renderDiagnosticsPage(result?: DiagnosticResult): string {
  const resultBlock = result ? `
    <div class="card">
      <h2>${escapeHtml(result.title)}</h2>
      <div class="${result.success ? 'info' : 'error'}">${result.success ? 'Success' : 'Failed'}</div>
      ${typeof result.details === 'string'
        ? `<pre>${escapeHtml(result.details)}</pre>`
        : `<pre>${escapeHtml(JSON.stringify(result.details, null, 2))}</pre>`}
    </div>
  ` : '';

  return `
    ${resultBlock}
    <div class="card">
      <h2>Capabilities</h2>
      <p style="color: #666; font-size: 0.85rem; margin-bottom: 0.75rem;">
        Lists all IMAP capabilities supported by the server, including extensions like IDLE, CONDSTORE, and QRESYNC.
      </p>
      <form method="post" action="/diagnostics/capabilities">
        <button class="btn" type="submit">Refresh & List Capabilities</button>
      </form>
    </div>

    <div class="card">
      <h2>Mailboxes</h2>
      <p style="color: #666; font-size: 0.85rem; margin-bottom: 0.75rem;">
        Gmail labels appear as mailboxes. System folders are under [Gmail]/ (Sent Mail, Trash, etc). Custom labels appear as top-level mailboxes.
      </p>
      
      <div style="display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 1rem;">
        <button class="btn" type="button" id="load-mailboxes-btn">Load Mailboxes</button>
        <div style="flex: 1;">
          <select id="mailbox-dropdown" style="width: 100%; padding: 0.55rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.95rem;">
            <option value="">-- Click "Load Mailboxes" first --</option>
          </select>
          <p style="color: #666; font-size: 0.8rem; margin-top: 0.25rem;">Select a mailbox to auto-fill forms below</p>
        </div>
      </div>
      
      <div id="mailbox-list" style="display: none; margin-bottom: 1rem; padding: 0.75rem; background: #f8f9fa; border-radius: 6px; border: 1px solid #eee; max-height: 200px; overflow-y: auto;">
        <strong style="font-size: 0.9rem;">Available Mailboxes:</strong>
        <div id="mailbox-list-content" style="margin-top: 0.5rem; font-family: monospace; font-size: 0.85rem;"></div>
      </div>

      <form method="post" action="/diagnostics/add-box" class="form-row">
        <label>Mailbox name
          <input name="mailboxName" placeholder="e.g., Test-Folder or Archive/2024" required 
                 title="Name for the new mailbox. Use / for nested folders (e.g., Archive/2024)."
                 pattern="[^\\x00-\\x1f\\x7f]+" 
                 oninvalid="this.setCustomValidity('Mailbox name cannot contain control characters')"
                 oninput="this.setCustomValidity('')">
        </label>
        <button class="btn" type="submit">Create Mailbox</button>
      </form>
      <form method="post" action="/diagnostics/rename-box" class="form-row">
        <label>Current name
          <input name="fromName" placeholder="e.g., Old-Folder" required 
                 title="The current name of the mailbox to rename">
        </label>
        <label>New name
          <input name="toName" placeholder="e.g., New-Folder" required 
                 title="The new name for the mailbox">
        </label>
        <button class="btn" type="submit">Rename Mailbox</button>
      </form>
      <form method="post" action="/diagnostics/delete-box" class="form-row">
        <label>Mailbox name
          <input name="mailboxName" placeholder="e.g., Test-Folder" required 
                 title="Name of the mailbox to delete. Warning: This cannot be undone!">
        </label>
        <button class="btn btn-danger" type="submit">Delete Mailbox</button>
      </form>
    </div>

    <script>
      document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM loaded, attaching event listeners');
        
        var loadBtn = document.getElementById('load-mailboxes-btn');
        var dropdown = document.getElementById('mailbox-dropdown');
        
        if (loadBtn) {
          loadBtn.addEventListener('click', loadMailboxes);
          console.log('Load button listener attached');
        } else {
          console.error('Load button not found');
        }
        
        if (dropdown) {
          dropdown.addEventListener('change', function() {
            selectMailbox(this.value);
          });
          console.log('Dropdown listener attached');
        }
      });
      
      function loadMailboxes() {
        var dropdown = document.getElementById('mailbox-dropdown');
        var listDiv = document.getElementById('mailbox-list');
        var listContent = document.getElementById('mailbox-list-content');
        
        dropdown.innerHTML = '<option value="">Loading...</option>';
        console.log('Loading mailboxes...');
        
        fetch('/diagnostics/mailboxes-json')
          .then(function(response) {
            console.log('Response status:', response.status);
            if (!response.ok) {
              throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return response.json();
          })
          .then(function(data) {
            console.log('Parsed data:', data);
            
            if (!data.success) {
              dropdown.innerHTML = '<option value="">Error: ' + (data.error || 'Failed to load') + '</option>';
              return;
            }
            
            var mailboxes = data.mailboxes;
            console.log('Mailboxes count:', mailboxes ? mailboxes.length : 'null');
            
            if (!mailboxes || mailboxes.length === 0) {
              dropdown.innerHTML = '<option value="">No mailboxes found</option>';
              return;
            }
            
            // Populate dropdown
            dropdown.innerHTML = '<option value="">-- Select a mailbox (' + mailboxes.length + ' found) --</option>';
            mailboxes.forEach(function(mb) {
              var opt = document.createElement('option');
              opt.value = mb.name;
              opt.textContent = mb.name + (mb.attributes && mb.attributes.length ? ' (' + mb.attributes.join(', ') + ')' : '');
              dropdown.appendChild(opt);
            });
            
            // Show list view
            listDiv.style.display = 'block';
            listContent.innerHTML = '';
            mailboxes.forEach(function(mb) {
              var div = document.createElement('div');
              div.style.cssText = 'padding: 0.25rem 0; cursor: pointer;';
              div.onclick = function() { selectMailbox(mb.name); };
              
              var isGmail = mb.name.startsWith('[Gmail]') ? ' 📁' : '';
              var isLabel = !mb.name.startsWith('[Gmail]') && mb.name !== 'INBOX' ? ' 🏷️' : '';
              var attrs = mb.attributes && mb.attributes.length ? ' <span style="color: #999;">(' + mb.attributes.join(', ') + ')</span>' : '';
              div.innerHTML = isGmail + isLabel + ' ' + mb.name + attrs;
              listContent.appendChild(div);
            });
            
            console.log('Mailboxes loaded successfully');
          })
          .catch(function(err) {
            console.error('Error loading mailboxes:', err);
            dropdown.innerHTML = '<option value="">Error: ' + err.message + '</option>';
          });
      }
      
      function selectMailbox(name) {
        if (!name) return;
        
        // Update all mailbox input fields on the page (for Messages & Flags section)
        var mailboxInputs = document.querySelectorAll('input[name="mailbox"]');
        for (var i = 0; i < mailboxInputs.length; i++) {
          mailboxInputs[i].value = name;
          mailboxInputs[i].style.backgroundColor = '#e8f4e8';
          (function(input) {
            setTimeout(function() { input.style.backgroundColor = ''; }, 500);
          })(mailboxInputs[i]);
        }
        
        // Update mailboxName fields (for Create/Rename/Delete section)
        var mailboxNameInputs = document.querySelectorAll('input[name="mailboxName"]');
        for (var i = 0; i < mailboxNameInputs.length; i++) {
          mailboxNameInputs[i].value = name;
          mailboxNameInputs[i].style.backgroundColor = '#e8f4e8';
          (function(input) {
            setTimeout(function() { input.style.backgroundColor = ''; }, 500);
          })(mailboxNameInputs[i]);
        }
        
        // Update fromName field (for Rename section - current name)
        var fromNameInput = document.querySelector('input[name="fromName"]');
        if (fromNameInput) {
          fromNameInput.value = name;
          fromNameInput.style.backgroundColor = '#e8f4e8';
          setTimeout(function() { fromNameInput.style.backgroundColor = ''; }, 500);
        }
        
        // Also update the dropdown
        document.getElementById('mailbox-dropdown').value = name;
      }
    </script>

    <div class="card">
      <h2>Messages & Flags</h2>
      <p style="color: #666; font-size: 0.85rem; margin-bottom: 0.75rem;">
        Search, fetch, and modify messages. Common flags: \\Seen (read), \\Flagged (starred), \\Deleted, \\Draft, \\Answered.
      </p>
      
      <h3 style="font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #444;">Open Mailbox</h3>
      <form method="post" action="/diagnostics/open-box" class="form-row">
        <label>Mailbox
          <input name="mailbox" value="INBOX" required 
                 title="Mailbox to open. Use INBOX for primary inbox, or folder names like [Gmail]/Sent Mail">
        </label>
        <label style="flex: 0 0 auto;">Read only?
          <input type="checkbox" name="readOnly" value="true" style="width: auto; margin-top: 0.5rem;"
                 title="Open in read-only mode (EXAMINE). Prevents flag changes.">
        </label>
        <button class="btn" type="submit">Open Mailbox</button>
      </form>

      <h3 style="font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #444;">Search Messages</h3>
      <form method="post" action="/diagnostics/search" class="form-row">
        <label>Mailbox
          <input name="mailbox" value="INBOX" required 
                 title="Mailbox to search in">
        </label>
        <label>Criteria (one per line)
          <textarea name="criteria" rows="3" placeholder="ALL&#10;UNSEEN&#10;FROM sender@example.com&#10;SINCE 2024-01-01"
                    title="Search criteria. Examples: ALL, UNSEEN, SEEN, FLAGGED, FROM email, SUBJECT text, SINCE date, BEFORE date"></textarea>
        </label>
        <label>Result limit
          <input name="limit" type="number" min="1" max="100" value="10" 
                 title="Maximum number of results to return (1-100)">
        </label>
        <button class="btn" type="submit">Search Messages</button>
      </form>

      <h3 style="font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #444;">Fetch Messages</h3>
      <form method="post" action="/diagnostics/fetch" class="form-row">
        <label>Mailbox
          <input name="mailbox" value="INBOX" required 
                 title="Mailbox to fetch from">
        </label>
        <label>UIDs
          <input name="uids" placeholder="e.g., 1,2,3 or 1:10" required 
                 pattern="[0-9,:*\\s]+"
                 title="Message UIDs to fetch. Use comma-separated (1,2,3) or ranges (1:10, 1:*)">
        </label>
        <label>Body parts
          <input name="bodies" value="HEADER.FIELDS (SUBJECT FROM DATE)" 
                 placeholder="e.g., HEADER, TEXT, 1, 1.1"
                 title="Body parts to fetch. Examples: HEADER, TEXT, HEADER.FIELDS (SUBJECT FROM), 1 (first part), 1.1 (nested part)">
        </label>
        <button class="btn" type="submit">Fetch Messages</button>
      </form>

      <h3 style="font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #444;">Flag Operations</h3>
      <form method="post" action="/diagnostics/add-flags" class="form-row">
        <label>Mailbox
          <input name="mailbox" value="INBOX" required>
        </label>
        <label>UIDs
          <input name="uids" placeholder="e.g., 1,2,3" required 
                 pattern="[0-9,:*\\s]+"
                 title="Message UIDs to modify">
        </label>
        <label>Flags to add
          <input name="flags" value="\\Seen" 
                 placeholder="e.g., \\Seen \\Flagged"
                 title="Flags to add. Common: \\Seen (read), \\Flagged (starred), \\Deleted, \\Draft, \\Answered">
        </label>
        <button class="btn" type="submit">Add Flags</button>
      </form>

      <form method="post" action="/diagnostics/remove-flags" class="form-row">
        <label>Mailbox
          <input name="mailbox" value="INBOX" required>
        </label>
        <label>UIDs
          <input name="uids" placeholder="e.g., 1,2,3" required 
                 pattern="[0-9,:*\\s]+"
                 title="Message UIDs to modify">
        </label>
        <label>Flags to remove
          <input name="flags" value="\\Seen" 
                 placeholder="e.g., \\Seen \\Flagged"
                 title="Flags to remove. Common: \\Seen (mark as unread), \\Flagged (unstar)">
        </label>
        <button class="btn" type="submit">Remove Flags</button>
      </form>

      <h3 style="font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #444;">Copy & Move</h3>
      <form method="post" action="/diagnostics/copy" class="form-row">
        <label>Source mailbox
          <input name="mailbox" value="INBOX" required 
                 title="Mailbox containing the messages to copy">
        </label>
        <label>UIDs
          <input name="uids" placeholder="e.g., 1,2,3" required 
                 pattern="[0-9,:*\\s]+"
                 title="Message UIDs to copy">
        </label>
        <label>Destination
          <input name="destination" placeholder="e.g., Archive or [Gmail]/All Mail" required 
                 title="Destination mailbox for the copied messages">
        </label>
        <button class="btn" type="submit">Copy Messages</button>
      </form>

      <form method="post" action="/diagnostics/move" class="form-row">
        <label>Source mailbox
          <input name="mailbox" value="INBOX" required 
                 title="Mailbox containing the messages to move">
        </label>
        <label>UIDs
          <input name="uids" placeholder="e.g., 1,2,3" required 
                 pattern="[0-9,:*\\s]+"
                 title="Message UIDs to move">
        </label>
        <label>Destination
          <input name="destination" placeholder="e.g., Archive or [Gmail]/Trash" required 
                 title="Destination mailbox. Messages will be copied then marked as deleted.">
        </label>
        <button class="btn" type="submit">Move Messages</button>
      </form>

      <h3 style="font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #444;">Expunge</h3>
      <form method="post" action="/diagnostics/expunge" class="form-row">
        <label>Mailbox
          <input name="mailbox" value="INBOX" required 
                 title="Mailbox to expunge. Permanently removes messages marked with \\Deleted flag."></label>
        <button class="btn btn-danger" type="submit">Expunge Deleted</button>
      </form>
    </div>

    <div class="card">
      <h2>IDLE - Real-time Notifications</h2>
      <p style="color: #666; margin-bottom: 1rem; font-size: 0.9rem;">
        IDLE allows the server to push notifications when the mailbox changes (new messages, deletions, flag changes).
        <br><strong>Note:</strong> Check capabilities first to verify IDLE support.
      </p>
      <div id="idle-form">
        <div class="form-row">
          <label>Mailbox
            <input id="idle-mailbox" name="mailbox" value="INBOX" placeholder="e.g., INBOX" required>
          </label>
          <label>Timeout (seconds)
            <input id="idle-timeout" name="timeout" type="number" min="5" max="300" value="30" placeholder="30">
          </label>
        </div>
        <div style="margin-top: 0.75rem;">
          <button id="idle-start" class="btn" type="button" onclick="startIdle()">Start IDLE</button>
          <button id="idle-stop" class="btn btn-danger" type="button" onclick="stopIdle()" style="display: none;">Stop IDLE</button>
        </div>
      </div>
      <div id="idle-status" style="margin-top: 1rem; display: none;">
        <div class="info" id="idle-status-text">Connecting...</div>
      </div>
      <div id="idle-notifications" style="margin-top: 1rem; display: none;">
        <h3 style="font-size: 1rem; margin-bottom: 0.5rem;">Notifications</h3>
        <div id="idle-notification-list" style="max-height: 300px; overflow-y: auto; background: #f8f9fa; border-radius: 6px; padding: 0.5rem; border: 1px solid #eee;">
          <p style="color: #999; font-size: 0.9rem;">Waiting for notifications...</p>
        </div>
      </div>
    </div>

    <script>
      let idleEventSource = null;
      
      function startIdle() {
        const mailbox = document.getElementById('idle-mailbox').value || 'INBOX';
        const timeout = document.getElementById('idle-timeout').value || '30';
        
        // Update UI
        document.getElementById('idle-start').style.display = 'none';
        document.getElementById('idle-stop').style.display = 'inline-block';
        document.getElementById('idle-status').style.display = 'block';
        document.getElementById('idle-notifications').style.display = 'block';
        document.getElementById('idle-status-text').textContent = 'Connecting to ' + mailbox + '...';
        document.getElementById('idle-status-text').className = 'info';
        document.getElementById('idle-notification-list').innerHTML = '<p style="color: #999; font-size: 0.9rem;">Waiting for notifications...</p>';
        
        // Start SSE connection
        idleEventSource = new EventSource('/diagnostics/idle/stream?mailbox=' + encodeURIComponent(mailbox) + '&timeout=' + timeout);
        
        idleEventSource.onmessage = function(event) {
          const data = JSON.parse(event.data);
          handleIdleEvent(data);
        };
        
        idleEventSource.onerror = function() {
          document.getElementById('idle-status-text').textContent = 'Connection lost';
          document.getElementById('idle-status-text').className = 'error';
          stopIdleUI();
        };
      }
      
      function handleIdleEvent(data) {
        const statusText = document.getElementById('idle-status-text');
        const notificationList = document.getElementById('idle-notification-list');
        
        switch (data.type) {
          case 'connected':
            statusText.textContent = 'Connected, opening mailbox ' + data.mailbox + '...';
            break;
          case 'mailbox_opened':
            statusText.textContent = 'Mailbox ' + data.mailbox + ' opened, starting IDLE...';
            break;
          case 'idle_started':
            statusText.textContent = 'IDLE active on ' + data.mailbox + ' - waiting for notifications';
            statusText.className = 'info';
            break;
          case 'exists':
            addNotification(notificationList, '📬 EXISTS', 'New message count: ' + data.count, data.timestamp);
            break;
          case 'expunge':
            addNotification(notificationList, '🗑️ EXPUNGE', 'Message ' + data.seqno + ' was deleted', data.timestamp);
            break;
          case 'fetch':
            const flagsStr = data.flags ? data.flags.join(', ') : 'none';
            addNotification(notificationList, '🔄 FETCH', 'Message ' + (data.seqno || data.uid) + ' flags changed: ' + flagsStr, data.timestamp);
            break;
          case 'recent':
            addNotification(notificationList, '🆕 RECENT', 'Recent count: ' + data.count, data.timestamp);
            break;
          case 'timeout':
            statusText.textContent = data.message;
            statusText.className = 'info';
            stopIdleUI();
            break;
          case 'idle_ended':
            statusText.textContent = 'IDLE session ended';
            stopIdleUI();
            break;
          case 'error':
            statusText.textContent = 'Error: ' + data.message;
            statusText.className = 'error';
            stopIdleUI();
            break;
        }
      }
      
      function addNotification(container, type, message, timestamp) {
        // Remove "waiting" message if present
        const waiting = container.querySelector('p');
        if (waiting && waiting.textContent.includes('Waiting')) {
          waiting.remove();
        }
        
        const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        const div = document.createElement('div');
        div.style.cssText = 'padding: 0.5rem; border-bottom: 1px solid #eee; font-size: 0.9rem;';
        div.innerHTML = '<strong>' + type + '</strong> <span style="color: #999; font-size: 0.8rem;">' + time + '</span><br>' + message;
        container.insertBefore(div, container.firstChild);
      }
      
      function stopIdle() {
        if (idleEventSource) {
          idleEventSource.close();
          idleEventSource = null;
        }
        
        // Also call the stop endpoint
        fetch('/diagnostics/idle/stop', { method: 'POST' })
          .then(r => r.json())
          .then(data => {
            document.getElementById('idle-status-text').textContent = data.message || 'IDLE stopped';
          })
          .catch(() => {});
        
        stopIdleUI();
      }
      
      function stopIdleUI() {
        document.getElementById('idle-start').style.display = 'inline-block';
        document.getElementById('idle-stop').style.display = 'none';
        if (idleEventSource) {
          idleEventSource.close();
          idleEventSource = null;
        }
      }
    </script>

    <div class="card">
      <h2>CONDSTORE / QRESYNC - Efficient Synchronization</h2>
      <p style="color: #666; margin-bottom: 1rem; font-size: 0.9rem;">
        CONDSTORE (RFC 7162) enables efficient flag synchronization using MODSEQ values.
        QRESYNC extends this with quick mailbox resynchronization and VANISHED responses.
        <br><strong>Note:</strong> Check capabilities first to verify support. Gmail supports CONDSTORE but not QRESYNC.
      </p>
      
      <div style="margin-bottom: 1rem; padding: 0.75rem; background: #f8f9fa; border-radius: 6px; border: 1px solid #eee;">
        <strong>Extension Status:</strong>
        <span id="condstore-status" style="margin-left: 0.5rem;">Check capabilities to see status</span>
      </div>

      <h3 style="font-size: 1rem; margin: 1rem 0 0.5rem;">Open Mailbox with QRESYNC</h3>
      <p style="color: #666; font-size: 0.85rem; margin-bottom: 0.5rem;">
        Opens a mailbox with QRESYNC parameters to get VANISHED UIDs since last sync.
        Requires saved uidValidity and lastModseq from a previous session.
      </p>
      <form method="post" action="/diagnostics/qresync-open" class="form-row">
        <label>Mailbox
          <input name="mailbox" value="INBOX" placeholder="e.g., INBOX" required title="The mailbox to open with QRESYNC">
        </label>
        <label>UID Validity
          <input name="uidValidity" type="number" placeholder="e.g., 1234567890" required title="The UIDVALIDITY value from a previous SELECT/EXAMINE">
        </label>
        <label>Last Known Modseq
          <input name="lastModseq" placeholder="e.g., 12345" required title="The highest MODSEQ value from a previous session">
        </label>
        <label>Known UIDs (optional)
          <input name="knownUids" placeholder="e.g., 1:100,150:200" title="Optional: UID ranges you have cached locally">
        </label>
        <button class="btn" type="submit">Open with QRESYNC</button>
      </form>

      <h3 style="font-size: 1rem; margin: 1rem 0 0.5rem;">Fetch with CHANGEDSINCE</h3>
      <p style="color: #666; font-size: 0.85rem; margin-bottom: 0.5rem;">
        Fetches only messages that have changed since a given MODSEQ value.
        Useful for incremental synchronization.
      </p>
      <form method="post" action="/diagnostics/fetch-changedsince" class="form-row">
        <label>Mailbox
          <input name="mailbox" value="INBOX" placeholder="e.g., INBOX" required title="The mailbox to fetch from">
        </label>
        <label>UIDs
          <input name="uids" placeholder="e.g., 1:* or 1,2,3" required title="UID range or list to fetch">
        </label>
        <label>Changed Since (Modseq)
          <input name="changedSince" placeholder="e.g., 12345" required title="Only return messages with MODSEQ greater than this value">
        </label>
        <label>Bodies
          <input name="bodies" value="HEADER.FIELDS (SUBJECT FROM DATE)" placeholder="Body parts to fetch" title="Which body parts to fetch">
        </label>
        <button class="btn" type="submit">Fetch Changed</button>
      </form>
    </div>
  `;
}

async function handleDiagnosticsAction(action: string, req: Request): Promise<DiagnosticResult> {
  const user = req.session.user!;
  const accessToken = req.session.accessToken!;

  switch (action) {
    case 'capabilities':
      return withClient(user, accessToken, async (client) => {
        const capabilities = await client.refreshCapabilities();
        return {
          title: 'Capabilities',
          success: true,
          details: {
            capabilities: Array.from(capabilities.values()),
            hasCondstore: client.hasCondstore(),
            hasQresync: client.hasQresync(),
            hasIdle: client.hasCapability('IDLE'),
          },
        };
      });
    case 'mailboxes':
      return withClient(user, accessToken, async (client) => {
        const boxes = await client.getBoxes();
        return { title: 'Mailboxes', success: true, details: boxes };
      });
    case 'add-box': {
      const mailboxName = (req.body.mailboxName || '').trim();
      if (!mailboxName) return { title: 'Add mailbox', success: false, details: 'Mailbox name is required' };
      return withClient(user, accessToken, async (client) => {
        await client.addBox(mailboxName);
        return { title: 'Add mailbox', success: true, details: { mailboxName } };
      });
    }
    case 'rename-box': {
      const fromName = (req.body.fromName || '').trim();
      const toName = (req.body.toName || '').trim();
      if (!fromName || !toName) return { title: 'Rename mailbox', success: false, details: 'Both names are required' };
      return withClient(user, accessToken, async (client) => {
        await client.renameBox(fromName, toName);
        return { title: 'Rename mailbox', success: true, details: { fromName, toName } };
      });
    }
    case 'delete-box': {
      const mailboxName = (req.body.mailboxName || '').trim();
      if (!mailboxName) return { title: 'Delete mailbox', success: false, details: 'Mailbox name is required' };
      return withClient(user, accessToken, async (client) => {
        await client.delBox(mailboxName);
        return { title: 'Delete mailbox', success: true, details: { mailboxName } };
      });
    }
    case 'open-box': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const readOnly = req.body.readOnly === 'true' || req.body.readOnly === 'on';
      return withClient(user, accessToken, async (client) => {
        const box = await client.openBox(mailbox, readOnly);
        return {
          title: 'Open mailbox',
          success: true,
          details: {
            mailbox,
            readOnly,
            messages: box.messages,
            uidValidity: box.uidvalidity,
            highestModseq: box.highestModseq?.toString() || null,
          },
        };
      });
    }
    case 'search': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const limit = Number(req.body.limit) || 10;
      const criteriaInput = typeof req.body.criteria === 'string' ? req.body.criteria : '';
      const criteria = parseSearchCriteria(criteriaInput);
      return withClient(user, accessToken, async (client) => {
        await client.openBox(mailbox);
        const messages = await client.search(criteria, { bodies: ['HEADER.FIELDS (SUBJECT FROM DATE)'], markSeen: false });
        const samples = messages.slice(0, limit).map(msg => {
          // Find header part - it might be named 'HEADER' or 'HEADER.FIELDS (...)'
          const headerPart = msg.parts?.find(p => 
            p.which.toUpperCase().includes('HEADER') || 
            p.which === 'HEADER.FIELDS (SUBJECT FROM DATE)'
          );
          const headers = headerPart 
            ? parseHeaders(typeof headerPart.body === 'string' ? headerPart.body : headerPart.body.toString())
            : new Map();
          return {
            uid: msg.uid,
            flags: msg.attributes?.flags || [],
            subject: headers.get('subject'),
            from: headers.get('from'),
            date: headers.get('date'),
          };
        });
        return {
          title: 'Search mailbox',
          success: true,
          details: { mailbox, criteria, returned: messages.length, samples },
        };
      });
    }
    case 'fetch': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const uids = parseUidList(req.body.uids);
      const bodies = parseBodiesInput(req.body.bodies);
      if (uids.length === 0) return { title: 'Fetch', success: false, details: 'Provide at least one UID' };
      return withClient(user, accessToken, async (client) => {
        await client.openBox(mailbox);
        const fetched = await client.fetch(uids, { bodies, struct: true, envelope: true, markSeen: false });
        const summary = fetched.map(msg => ({
          uid: msg.uid,
          flags: msg.attributes.flags,
          bodies: msg.parts.map(p => p.which),
        }));
        return {
          title: 'Fetch messages',
          success: true,
          details: { mailbox, uids, bodies, count: fetched.length, summary },
        };
      });
    }
    case 'add-flags': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const uids = parseUidList(req.body.uids);
      const flags = parseFlags(req.body.flags);
      if (!uids.length) return { title: 'Add flags', success: false, details: 'Provide UIDs' };
      if (!flags.length) return { title: 'Add flags', success: false, details: 'Provide flags' };
      return withClient(user, accessToken, async (client) => {
        await client.openBox(mailbox);
        await client.addFlags(uids, flags);
        return { title: 'Add flags', success: true, details: { mailbox, uids, flags } };
      });
    }
    case 'remove-flags': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const uids = parseUidList(req.body.uids);
      const flags = parseFlags(req.body.flags);
      if (!uids.length) return { title: 'Remove flags', success: false, details: 'Provide UIDs' };
      if (!flags.length) return { title: 'Remove flags', success: false, details: 'Provide flags' };
      return withClient(user, accessToken, async (client) => {
        await client.openBox(mailbox);
        await client.delFlags(uids, flags);
        return { title: 'Remove flags', success: true, details: { mailbox, uids, flags } };
      });
    }
    case 'copy': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const destination = (req.body.destination || '').trim();
      const uids = parseUidList(req.body.uids);
      if (!uids.length) return { title: 'Copy messages', success: false, details: 'Provide UIDs' };
      if (!destination) return { title: 'Copy messages', success: false, details: 'Destination mailbox required' };
      return withClient(user, accessToken, async (client) => {
        await client.openBox(mailbox);
        await client.copy(uids, destination);
        return { title: 'Copy messages', success: true, details: { mailbox, destination, uids } };
      });
    }
    case 'move': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const destination = (req.body.destination || '').trim();
      const uids = parseUidList(req.body.uids);
      if (!uids.length) return { title: 'Move messages', success: false, details: 'Provide UIDs' };
      if (!destination) return { title: 'Move messages', success: false, details: 'Destination mailbox required' };
      return withClient(user, accessToken, async (client) => {
        await client.openBox(mailbox);
        await client.move(uids, destination);
        return { title: 'Move messages', success: true, details: { mailbox, destination, uids } };
      });
    }
    case 'expunge': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      return withClient(user, accessToken, async (client) => {
        await client.openBox(mailbox);
        await client.expunge();
        return { title: 'Expunge', success: true, details: { mailbox } };
      });
    }
    case 'qresync-open': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const uidValidityStr = (req.body.uidValidity || '').trim();
      const lastModseqStr = (req.body.lastModseq || '').trim();
      const knownUids = (req.body.knownUids || '').trim();
      
      if (!uidValidityStr) return { title: 'QRESYNC Open', success: false, details: 'UID Validity is required' };
      if (!lastModseqStr) return { title: 'QRESYNC Open', success: false, details: 'Last Known Modseq is required' };
      
      const uidValidity = parseInt(uidValidityStr, 10);
      if (isNaN(uidValidity)) return { title: 'QRESYNC Open', success: false, details: 'Invalid UID Validity value' };
      
      let lastKnownModseq: bigint;
      try {
        lastKnownModseq = BigInt(lastModseqStr);
      } catch {
        return { title: 'QRESYNC Open', success: false, details: 'Invalid Modseq value' };
      }
      
      return withClient(user, accessToken, async (client) => {
        // Check if QRESYNC is supported
        await client.refreshCapabilities();
        const hasQresync = client.hasQresync();
        const hasCondstore = client.hasCondstore();
        
        if (!hasQresync) {
          return {
            title: 'QRESYNC Open',
            success: false,
            details: {
              error: 'Server does not support QRESYNC extension',
              hasCondstore,
              hasQresync,
              suggestion: hasCondstore 
                ? 'CONDSTORE is supported. Use "Fetch with CHANGEDSINCE" instead for incremental sync.'
                : 'Neither CONDSTORE nor QRESYNC is supported by this server.',
            },
          };
        }
        
        const qresyncParams: {
          uidValidity: number;
          lastKnownModseq: bigint;
          knownUids?: string;
        } = {
          uidValidity,
          lastKnownModseq,
        };
        
        if (knownUids) {
          qresyncParams.knownUids = knownUids;
        }
        
        const result = await client.openBoxWithQresync(mailbox, qresyncParams);
        
        return {
          title: 'QRESYNC Open',
          success: true,
          details: {
            mailbox,
            uidValidity,
            lastKnownModseq: lastKnownModseq.toString(),
            knownUids: knownUids || '(none)',
            result: {
              messages: result.mailbox.messages,
              currentUidValidity: result.mailbox.uidvalidity,
              highestModseq: result.mailbox.highestModseq?.toString() || '(not available)',
              vanishedUids: result.vanished,
              vanishedCount: result.vanished.length,
              vanishedEarlier: result.vanishedEarlier,
            },
          },
        };
      });
    }
    case 'fetch-changedsince': {
      const mailbox = (req.body.mailbox || 'INBOX').trim();
      const uidsInput = (req.body.uids || '').trim();
      const changedSinceStr = (req.body.changedSince || '').trim();
      const bodies = parseBodiesInput(req.body.bodies);
      
      if (!uidsInput) return { title: 'Fetch CHANGEDSINCE', success: false, details: 'UIDs are required' };
      if (!changedSinceStr) return { title: 'Fetch CHANGEDSINCE', success: false, details: 'Changed Since (Modseq) is required' };
      
      let changedSince: bigint;
      try {
        changedSince = BigInt(changedSinceStr);
      } catch {
        return { title: 'Fetch CHANGEDSINCE', success: false, details: 'Invalid Modseq value' };
      }
      
      return withClient(user, accessToken, async (client) => {
        // Check if CONDSTORE is supported
        await client.refreshCapabilities();
        const hasCondstore = client.hasCondstore();
        
        if (!hasCondstore) {
          return {
            title: 'Fetch CHANGEDSINCE',
            success: false,
            details: {
              error: 'Server does not support CONDSTORE extension',
              hasCondstore,
              suggestion: 'CONDSTORE is required for CHANGEDSINCE modifier.',
            },
          };
        }
        
        await client.openBox(mailbox);
        
        // Parse UIDs - support both ranges (1:*) and lists (1,2,3)
        const uidSequence = uidsInput.includes(':') ? uidsInput : parseUidList(uidsInput).join(',');
        
        const fetched = await client.fetch(uidSequence, {
          bodies,
          struct: true,
          envelope: true,
          markSeen: false,
          changedSince,
          modseq: true,
        });
        
        const summary = fetched.map(msg => ({
          uid: msg.uid,
          flags: msg.attributes.flags,
          modseq: msg.attributes.modseq?.toString() || '(not available)',
          bodies: msg.parts.map(p => p.which),
        }));
        
        return {
          title: 'Fetch CHANGEDSINCE',
          success: true,
          details: {
            mailbox,
            uids: uidsInput,
            changedSince: changedSince.toString(),
            bodies,
            returnedCount: fetched.length,
            note: fetched.length === 0 
              ? 'No messages have changed since the specified MODSEQ value'
              : `${fetched.length} message(s) have changed since MODSEQ ${changedSince}`,
            messages: summary,
          },
        };
      });
    }
    default:
      return { title: 'Unknown action', success: false, details: action };
  }
}

async function withClient(
  user: string,
  accessToken: string,
  fn: (client: ImapClient) => Promise<DiagnosticResult>
): Promise<DiagnosticResult> {
  const client = await createImapClient(user, accessToken);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function parseUidList(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[,\\s]+/)
    .map(v => parseInt(v, 10))
    .filter(n => !Number.isNaN(n));
}

function parseFlags(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[,\\s]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function parseBodiesInput(value: unknown): string | string[] {
  if (typeof value !== 'string' || !value.trim()) return ['HEADER'];
  const parts = value.split(/[,\\n]+/).map(v => v.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0] : parts;
}

function parseSearchCriteria(input: string): SearchCriteria[] {
  const lines = input
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length) return ['ALL'];

  return lines.map(line => {
    const [head, ...rest] = line.split(/\s+/);
    const remainder = rest.join(' ').trim();
    if (!remainder) return head as SearchCriteria;
    if (['SINCE', 'BEFORE', 'ON'].includes(head.toUpperCase())) {
      const parsedDate = new Date(remainder);
      return [head.toUpperCase(), parsedDate] as SearchCriteria;
    }
    return [head.toUpperCase(), remainder] as SearchCriteria;
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`\n📧 Gmail Viewer running at ${BASE_URL}`);
  console.log(`\nMake sure to add "${BASE_URL}${CALLBACK_PATH}" to your OAuth2 redirect URIs\n`);
  
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('⚠️  Warning: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set');
    console.log('   Set these environment variables to enable OAuth2 authentication\n');
  }
});
