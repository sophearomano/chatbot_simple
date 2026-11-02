// A stand-in for the WhatsApp API. The real server talks to it over HTTP.
import http from 'node:http';

export function startFakes() {
  const whatsappSent = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      whatsappSent.push({ url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"messages":[{"id":"wamid.out"}]}');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, whatsappSent, close: () => server.close() });
    });
  });
}
