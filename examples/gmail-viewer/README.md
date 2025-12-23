# Gmail Viewer Web App

A secure web-based Gmail viewer demonstrating `@dyanet/imap` with OAuth2 authentication.

## Features

- 🔐 Secure OAuth2 authentication with Google
- 🛡️ Security headers via Helmet
- 🔒 CSRF protection with state parameter
- 🍪 Secure session management
- 🔄 Automatic token refresh
- 📧 View inbox emails with sender, subject, and date

## Prerequisites

- Node.js 20.0.0 or higher
- A Google Cloud project with Gmail API enabled
- OAuth2 credentials (Web application type)

## Setup

### 1. Create Google Cloud OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the Gmail API:
   - Go to "APIs & Services" > "Library"
   - Search for "Gmail API" and enable it
4. Create OAuth2 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Select "Web application" as the application type
   - Add `http://localhost:3000/callback` to "Authorized redirect URIs"
   - Save your Client ID and Client Secret

### 2. Configure Environment Variables

Create a `.env` file or set environment variables:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
SESSION_SECRET=your-random-secret-key  # Optional, auto-generated if not set
PORT=3000                               # Optional, defaults to 3000
BASE_URL=http://localhost:3000          # Optional, for production deployment
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Build and Run

```bash
npm run build
npm start
```

Or for development:

```bash
npm run dev
```

### 5. Open in Browser

Navigate to `http://localhost:3000` and sign in with your Google account.

## Security Features

- **Helmet**: Sets secure HTTP headers (CSP, X-Frame-Options, etc.)
- **CSRF Protection**: OAuth2 state parameter prevents cross-site request forgery
- **Secure Sessions**: HTTP-only cookies with SameSite protection
- **No Credentials Storage**: Access tokens stored only in session, not persisted
- **Token Refresh**: Automatic token refresh when expired

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth2 Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth2 Client Secret |
| `SESSION_SECRET` | No | Secret for session encryption (auto-generated if not set) |
| `PORT` | No | Server port (default: 3000) |
| `BASE_URL` | No | Base URL for OAuth callbacks (default: http://localhost:PORT) |
| `NODE_ENV` | No | Set to "production" for secure cookies |

## Production Deployment

For production:

1. Set `NODE_ENV=production` for secure cookies
2. Use HTTPS and set `BASE_URL` to your domain
3. Set a strong `SESSION_SECRET`
4. Update OAuth2 redirect URIs in Google Cloud Console

```bash
NODE_ENV=production \
BASE_URL=https://your-domain.com \
SESSION_SECRET=$(openssl rand -hex 32) \
GOOGLE_CLIENT_ID=... \
GOOGLE_CLIENT_SECRET=... \
npm start
```

## Troubleshooting

### "redirect_uri_mismatch" error
- Ensure `http://localhost:3000/callback` is in your OAuth2 authorized redirect URIs
- For production, add your production callback URL

### "Invalid credentials" error
- Your access token may have expired
- The app will automatically try to refresh it
- If refresh fails, you'll be redirected to login

### Session issues
- Clear your browser cookies for localhost
- Restart the server

## License

MIT
