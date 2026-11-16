import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createCompanion } from './companion.mjs';

export function evaluateAction(event) {
  if (event?.action !== 'place' || typeof event.object !== 'string' || typeof event.location !== 'string') {
    return null;
  }
  const objectCorrect = event.object === 'water';
  const locationCorrect = event.location === 'target';
  return { objectCorrect, locationCorrect, accepted: objectCorrect && locationCorrect };
}

export function createBridge({
  directory = process.env.ISLAND_HISTORY_DIR || '.luanti-history',
  ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model = process.env.OLLAMA_MODEL || 'qwen3:14b',
  fetchModel,
} = {}) {
  const companion = createCompanion({ directory, ollamaUrl, model, fetchModel });
  return createServer({ requestTimeout: 5000 }, async (request, response) => {
    if (request.method === 'GET' && request.url === '/voice') {
      try {
        const page = await readFile(new URL('./voice.html', import.meta.url));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(page);
      } catch {
        response.writeHead(500).end();
      }
      return;
    }
    if (request.method !== 'POST' || !['/practice/action', '/practice/companion'].includes(request.url)) {
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
      let event;
      try {
        event = JSON.parse(body);
      } catch {
        response.writeHead(400).end();
        return;
      }
      const result = request.url === '/practice/action' ? evaluateAction(event) : await companion(event);
      if (!result) {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    } catch (error) {
      console.error('Luanti bridge request failed:', error.message);
      response.writeHead(503).end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createBridge().listen(3217, '127.0.0.1', () => console.log('Luanti bridge on 127.0.0.1:3217'));
}
