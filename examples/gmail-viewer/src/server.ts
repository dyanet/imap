/**
 * Gmail Viewer - Express Web Application
 * 
 * A secure web-based Gmail viewer using @dyanet/imap with OAuth2 authentication.
 */

import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import crypto from 'crypto';
import https from 'https';
import { ImapClient, parseHeaders } from '@dyanet/imap';

// Extend session data
declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
    user?: string;
    accessToken?: string;
    refreshToken?: string;
  }
}

// Configuration
const PORT = parseInt(process.env.PORT || '3000', 10);
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
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
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
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
}> {
  const params = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: `${BASE_URL}${CALLBACK_PATH}`,
    grant_type: 'authorization_code',
  });

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
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          resolve({
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
          });
        } catch (err) {
          reject(new Error('Failed to parse token response'));
        }
      });
    });

    req.on('error', err => reject(err));
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
 * Refresh access token
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

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
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          resolve(response.access_token);
        } catch (err) {
          reject(new Error('Failed to refresh token'));
        }
      });
    });

    req.on('error', err => reject(err));
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
 * Fetch emails from Gmail
 */
async function fetchEmails(user: string, accessToken: string, limit: number = 20): Promise<Array<{
  uid: number;
  subject: string;
  from: string;
  date: Date;
  flags: string[];
}>> {
  const client = await ImapClient.connect({
    imap: {
      host: 'imap.gmail.com',
      port: 993,
      user,
      tls: true,
      xoauth2: { user, accessToken },
    },
  });

  try {
    await client.openBox('INBOX');
    const uids = await client.search(['ALL']);
    const latestUids = uids.sort((a, b) => b - a).slice(0, limit);

    if (latestUids.length === 0) return [];

    const messages = await client.fetch(latestUids, {
      bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'],
    });

    return messages.map(msg => {
      const headerPart = msg.parts.find(p => p.which.toUpperCase().includes('HEADER'));
      const headers = headerPart 
        ? parseHeaders(typeof headerPart.body === 'string' ? headerPart.body : headerPart.body.toString())
        : new Map();

      const fromHeader = headers.get('from');
      const subjectHeader = headers.get('subject');
      const dateHeader = headers.get('date');

      return {
        uid: msg.uid,
        subject: (Array.isArray(subjectHeader) ? subjectHeader[0] : subjectHeader) || '(No Subject)',
        from: (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) || '(Unknown)',
        date: dateHeader ? new Date(Array.isArray(dateHeader) ? dateHeader[0] : dateHeader) : new Date(),
        flags: msg.attributes.flags,
      };
    }).sort((a, b) => b.date.getTime() - a.date.getTime());
  } finally {
    await client.end();
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
    .email-subject { flex: 1; }
    .email-from { color: #666; width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .email-date { color: #999; width: 150px; text-align: right; }
    .center { text-align: center; }
    .error { color: #dc3545; padding: 1rem; background: #f8d7da; border-radius: 4px; margin-bottom: 1rem; }
    .info { color: #0c5460; padding: 1rem; background: #d1ecf1; border-radius: 4px; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📧 Gmail Viewer</h1>
    ${user ? `<div><span>${user}</span> | <a href="/logout">Logout</a></div>` : ''}
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

    res.redirect('/inbox');
  } catch (err) {
    res.send(baseTemplate('Error', `
      <div class="card">
        <div class="error">Failed to authenticate: ${err instanceof Error ? err.message : 'Unknown error'}</div>
        <a href="/login" class="btn">Try Again</a>
      </div>
    `));
  }
});

app.get('/inbox', requireAuth, async (req, res) => {
  try {
    const emails = await fetchEmails(req.session.user!, req.session.accessToken!);

    const emailListHtml = emails.length > 0
      ? `<ul class="email-list">${emails.map(email => `
          <li class="email-item ${email.flags.includes('\\Seen') ? '' : 'email-unread'}">
            <span class="email-from" title="${escapeHtml(email.from)}">${escapeHtml(extractName(email.from))}</span>
            <span class="email-subject">${escapeHtml(email.subject)}</span>
            <span class="email-date">${formatDate(email.date)}</span>
          </li>
        `).join('')}</ul>`
      : '<p class="center" style="padding: 2rem; color: #666;">No emails found.</p>';

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
    // Try to refresh token if authentication failed
    if (req.session.refreshToken && err instanceof Error && 
        (err.message.includes('AUTHENTICATIONFAILED') || err.message.includes('Invalid credentials'))) {
      try {
        req.session.accessToken = await refreshAccessToken(req.session.refreshToken);
        res.redirect('/inbox');
        return;
      } catch {
        // Refresh failed, redirect to login
      }
    }

    res.send(baseTemplate('Error', `
      <div class="card">
        <div class="error">Failed to fetch emails: ${err instanceof Error ? err.message : 'Unknown error'}</div>
        <a href="/inbox" class="btn">Retry</a>
        <a href="/logout" class="btn btn-danger" style="margin-left: 0.5rem;">Logout</a>
      </div>
    `, req.session.user));
  }
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

function formatDate(date: Date): string {
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

// Start server
app.listen(PORT, () => {
  console.log(`\n📧 Gmail Viewer running at ${BASE_URL}`);
  console.log(`\nMake sure to add "${BASE_URL}${CALLBACK_PATH}" to your OAuth2 redirect URIs\n`);
  
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('⚠️  Warning: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set');
    console.log('   Set these environment variables to enable OAuth2 authentication\n');
  }
});
