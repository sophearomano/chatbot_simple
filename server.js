import { config, whatsappEnabled } from './src/config.js';
import { server } from './src/http.js';

server.listen(config.port, () => {
  console.log(`${config.botName} is listening on http://localhost:${config.port}`);
  console.log(`WhatsApp channel: ${whatsappEnabled() ? 'on' : 'off'}`);
});
