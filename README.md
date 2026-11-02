# Orin

A chatbot in the style of [ELIZA](https://www.masswerk.at/elizabot/), the program Joseph Weizenbaum wrote at MIT in 1966. People can reach Orin from a website, from WhatsApp and from any other device, and devices linked with a code share one conversation.

Orin does not use any AI service. It looks for keywords in what you say and turns your own words back into a question, so it costs nothing to run and needs no API key. It does not understand anything: it cannot answer questions, look things up or give advice, and it only works in English.

The engine in `public/brain/eliza.js` and the rules in `public/brain/script.js` were written for this project. They follow ELIZA's method and do not copy elizabot.js.

## Run it on your computer

You need Node.js 24 or newer. There is nothing to install and no key to set.

```
npm start
```

Open <http://localhost:3000>.

## Change what it says

Everything Orin says is in `public/brain/script.js`. Each rule has a pattern, a rank and some replies. Higher ranks win.

```js
{ rank: 30, match: '* i am @sad *', replies: ['How long have you felt (2)?'] }
```

In `match`, `*` stands for any words and `@sad` for any word in the `sad` synonym group. In a reply, `(2)` is the second match, turned around so that "my" becomes "your". Add `keep` to a rule to save a note that Orin can bring up later.

## Put it online

**Website only, on Vercel.** `vercel.json` publishes the `public` folder. With no server behind it, the page runs Orin itself and saves each conversation only in that visitor's browser, so the website and the widget work, but WhatsApp and linked devices do not.

**Everything, on Render.** WhatsApp and linked devices need a server that stays on and keeps its files. `render.yaml` sets it up: choose **New > Blueprint** and pick this repository. Railway or any Node host also works if `DATA_DIR` points at a permanent disk. Without a permanent disk, every restart erases conversations and notes.

## Add it to a website

Paste this into any page. A chat button appears in the corner.

```html
<script src="https://YOUR-BOT-ADDRESS/widget.js" defer></script>
```

## Connect WhatsApp

**Read this first.** Since January 2026, WhatsApp's business terms restrict chatbots that are not tied to a specific business purpose. Check Meta's current terms before going live, because a bot that breaks them can have its number banned.

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
| `/forget` | Erases the notes Orin keeps about you |
| `/help` | Lists the commands |

## Limits and safety

`MESSAGES_PER_HOUR` and `IP_MESSAGES_PER_HOUR` limit each person and network. Set `ACCESS_CODE` to keep strangers out entirely.

Orin is not a therapist, and the page says so. If a message mentions suicide or self-harm, it stops playing its role and points the person to emergency services and <https://findahelpline.com>. That check is a fixed list of phrases in `public/brain/script.js`, so it will miss other wordings.

## Tests

```
npm test
```

The tests run the real server against a local stand-in for WhatsApp.
