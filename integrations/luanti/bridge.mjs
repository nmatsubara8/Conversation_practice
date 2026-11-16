import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function evaluateAction(event) {
  if (event?.action !== 'place' || typeof event.object !== 'string' || typeof event.location !== 'string') {
    return null;
  }
  const objectCorrect = event.object === 'water';
  const locationCorrect = event.location === 'target';
  return { objectCorrect, locationCorrect, accepted: objectCorrect && locationCorrect };
}

export function createBridge() {
  return createServer({ requestTimeout: 5000 }, async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/practice/action') {
      response.writeHead(404).end();
      return;
    }
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024) {
          response.writeHead(413).end();
          return;
        }
      }
      const result = evaluateAction(JSON.parse(body));
      if (!result) {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch {
      response.writeHead(400).end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createBridge().listen(3217, '127.0.0.1', () => console.log('Luanti bridge on 127.0.0.1:3217'));
}
