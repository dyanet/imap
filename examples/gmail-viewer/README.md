# Gmail Viewer Example

A simple example application demonstrating how to use `@dyanet/imap` to connect to Gmail and view emails using OAuth2 authentication.

## Prerequisites

- Node.js 20.0.0 or higher
- A Google Cloud project with Gmail API enabled
- OAuth2 credentials (Desktop application type)

## Quick Start

### 1. Create Google Cloud OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the Gmail API:
   - Go to "APIs & Services" > "Library"
   - Search for "Gmail API" and enable it
4. Create OAuth2 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Select "Desktop application" as the application type
   - Download the credentials JSON file
5. Configure OAuth consent screen:
   - Add `http://localhost:3000/callback` as an authorized redirect URI

### 2. Install Dependencies

```bash
npm install
```

### 3. Authorize with Gmail

Run the authorization command to get your OAuth2 tokens:

```bash
npm run auth
```

This will:
1. Prompt for your Google Client ID and Secret (if not in environment)
2. Open your browser to Google's authorization page
3. Start a local server to receive the callback
4. Exchange the authorization code for access and refresh tokens
5. Display the tokens to save in your `.env` file

### 4. Run the Gmail Viewer

```bash
npm start
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run auth` | Perform OAuth2 authorization flow to get tokens |
| `npm run refresh` | Refresh an expired access token |
| `npm start` | Run the Gmail viewer |
| `npm run dev` | Build and run in one step |
| `npm run build` | Compile TypeScript only |

## Configuration

### Environment Variables

Create a `.env` file with your credentials:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `GMAIL_USER` | Yes | Your Gmail address |
| `GMAIL_ACCESS_TOKEN` | Yes | OAuth2 access token |
| `GOOGLE_CLIENT_ID` | For refresh | OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | For refresh | OAuth2 client secret |
| `GOOGLE_REFRESH_TOKEN` | For refresh | Refresh token for auto-renewal |

### Manual Token Setup (Alternative)

If you prefer to get tokens manually using the OAuth2 Playground:

1. Go to [OAuth2 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) and check "Use your own OAuth credentials"
3. Enter your Client ID and Client Secret
4. In Step 1, select "Gmail API v1" > "https://mail.google.com/"
5. Click "Authorize APIs" and sign in with your Gmail account
6. In Step 2, click "Exchange authorization code for tokens"
7. Copy the tokens to your `.env` file

## Usage

The application will:
1. Connect to Gmail's IMAP server using OAuth2
2. Open your INBOX
3. Display the latest 10 emails with:
   - Subject
   - From address
   - Date received
4. Show a "...more" indicator if there are additional emails

### Interactive Mode

If no credentials are found in environment variables, the app will prompt you interactively:

```
📧 Gmail Viewer - @dyanet/imap Example
======================================

No credentials found in environment variables.
Please enter your Gmail OAuth2 credentials:

Gmail address: user@gmail.com
Access token: ****
```

## Example Output

```
📧 Gmail Viewer - @dyanet/imap Example
======================================

Using credentials from environment for: user@gmail.com

Connecting to Gmail...
✓ Connected successfully

Opening INBOX...
✓ INBOX opened (42 messages, 3 unseen)

Latest 10 emails:
─────────────────────────────────────────────

1. Meeting Tomorrow
   From: colleague@company.com
   Date: 01/15/2024, 10:30 AM

2. Your order has shipped
   From: orders@amazon.com
   Date: 01/15/2024, 09:15 AM

...

─────────────────────────────────────────────
...and 32 more emails in INBOX

Disconnecting...
✓ Disconnected
```

## Troubleshooting

### "Invalid credentials" error
- Your access token may have expired (tokens last ~1 hour)
- Run `npm run refresh` to get a new token
- Or run `npm run auth` to re-authorize

### "IMAP access disabled" error
- Enable IMAP in Gmail settings: Settings > See all settings > Forwarding and POP/IMAP
- Make sure IMAP is enabled for your account

### "redirect_uri_mismatch" error
- Add `http://localhost:3000/callback` to your OAuth2 credentials' authorized redirect URIs
- Go to Google Cloud Console > APIs & Services > Credentials > Edit your OAuth client

### Connection timeout
- Check your network connection
- Gmail's IMAP server is `imap.gmail.com` on port 993 (TLS)

### Port 3000 already in use
- Another application is using port 3000
- Stop the other application or modify `CALLBACK_PORT` in `oauth2.ts`

## Development

When developing locally, the example uses `file:../..` to reference the parent @dyanet/imap package. For production use, change the dependency to:

```json
"@dyanet/imap": "^0.2.0"
```

## License

MIT
