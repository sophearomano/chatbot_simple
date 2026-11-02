# Orin

One intelligent assistant that people can reach from a website, from WhatsApp and from any other device. It runs on Claude Opus 5.5, reasons before it answers, searches the web, and keeps notes about each person. Devices linked with a code share one conversation.

## Run it on your computer

You need Node.js 24 or newer and an API key from <https://console.anthropic.com>. API use is billed separately from a Claude subscription.

```
npm install
copy .env.example .env
```

Put your key in `.env` after `ANTHROPIC_API_KEY=`, then:

```
npm start
```

Open <http://localhost:3000>.

## Put it online

The bot needs a server that stays on and keeps its files, so Vercel does not fit. `render.yaml` sets it up on Render: choose **New > Blueprint**, pick this repository, and fill in the secrets it asks for. Railway or any Node host also works if `DATA_DIR` points at a permanent disk. Without a permanent disk, every restart erases conversations and notes.

## Add it to a website

Paste this into any page. A chat button appears in the corner.

```html
<script src="https://YOUR-BOT-ADDRESS/widget.js" defer></script>
```

## Connect WhatsApp

**Read this first.** Since January 2026, WhatsApp's business terms forbid general-purpose AI assistants on its Business Platform. AI that serves a specific business purpose, such as customer support, sales or bookings, is allowed. Set `BOT_PURPOSE` to that purpose before going live. Check Meta's current terms, because a bot that breaks them can have its number banned.

1. Create a Business app at <https://developers.facebook.com> and add the WhatsApp product.
2. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, and a `WHATSAPP_VERIFY_TOKEN` you invent.
3. In the app's WhatsApp configuration, set the callback URL to `https://YOUR-BOT-ADDRESS/webhook/whatsapp`, enter the same verify token, and subscribe to `messages`.

## Connect any other device

Anything that can make an HTTPS request can talk to the bot.

```
curl -X POST https://YOUR-BOT-ADDRESS/api/session
# {"token":"..."}  keep this secret

curl -X POST https://YOUR-BOT-ADDRESS/api/chat \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"Hello\"}"
```

Add `-H "Accept: text/event-stream"` to receive the reply word by word.

## Commands

These work on every channel.

| Command | What it does |
|---|---|
| `/link` | Gives a 6-digit code, valid for 10 minutes |
| `/link 123456` | Joins this device to the account that made the code |
| `/new` | Starts a fresh conversation and keeps saved notes |
| `/help` | Lists the commands |

## Cost and limits

Claude Opus 5.5 costs $4 per million input tokens and $20 per million output tokens, and web searches cost about $0.01 each. `DAILY_BUDGET_USD` stops the bot for the day once its own estimate reaches that amount; it is $5 by default. Also set a monthly limit in the Anthropic Console, because the estimate is not your bill. `MESSAGES_PER_HOUR` and `IP_MESSAGES_PER_HOUR` limit each person and network. Set `ACCESS_CODE` to keep strangers out entirely.

To spend less, set `BOT_MODEL=claude-sonnet-5-5` or `BOT_EFFORT=medium`.

## Tests

```
npm test
```

The tests run the real server and the real Anthropic SDK against local stand-ins for Claude and WhatsApp, so they need no keys and spend nothing.
