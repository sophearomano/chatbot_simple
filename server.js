import { config, whatsappEnabled } from './src/config.js';
import { server } from './src/http.js';

server.listen(config.port, () => {
  console.log(`${config.botName} is listening on http://localhost:${config.port}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn('ANTHROPIC_API_KEY is not set, so the bot cannot answer yet. See .env.example.');
  }
  console.log(`WhatsApp channel: ${whatsappEnabled() ? 'on' : 'off'}`);
});
