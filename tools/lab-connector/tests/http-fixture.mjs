// Local transport fixture only. No environment files, credentials, printer or
// outbound requests are read or used. Listen exclusively on loopback.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const readyFile = args.get('--ready-file'), metadataFile = args.get('--metadata-file');
if (!readyFile || !metadataFile || !path.isAbsolute(readyFile) || !path.isAbsolute(metadataFile)) throw Error('Use absolute --ready-file and --metadata-file paths.');
const deviceId = '11111111-1111-4111-a111-111111111111';
const deviceToken = 'c'.repeat(64), pairCode = 'b'.repeat(32);
// Deliberately generic JPEG-shaped bytes: these tests cover byte transport;
// full JPEG decoding/geometry is covered by connector.test.ps1.
const payload = Buffer.from(Array.from({ length: 64 }, (_, i) => i));
payload[0] = 0xff; payload[1] = 0xd8; payload[62] = 0xff; payload[63] = 0xd9;
const metadata = { fixtureVersion: 1, host: '127.0.0.1', port: 0, requests: [], counts: {}, externalRequests: 0 };
const sockets = new Set();
const publishMetadata = () => { const temporary = `${metadataFile}.new`; fs.writeFileSync(temporary, JSON.stringify(metadata, null, 2)); fs.renameSync(temporary, metadataFile); };
const json = (response, status, body) => { const bytes = Buffer.from(JSON.stringify(body)); response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': bytes.length }); response.end(bytes); };
const server = http.createServer({ maxHeaderSize: 8192 }, async (request, response) => {
  response.on('error', () => {});
  const url = new URL(request.url, 'http://127.0.0.1');
  const action = url.searchParams.get('action') || (request.method === 'POST' ? 'pair' : 'unknown');
  metadata.counts[action] = (metadata.counts[action] || 0) + 1;
  metadata.requests.push({ method: request.method, action, local: request.socket.localAddress === '127.0.0.1', authorized: request.headers.authorization === `Bearer ${deviceId}.${deviceToken}` });
  publishMetadata();
  if (url.pathname !== '/api/lab-connector') return json(response, 404, { ok: false });
  if (request.method === 'POST') {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 16000) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(response, 400, { ok: false }); }
    if (body.action !== 'pair' || body.pairCode !== pairCode || body.deviceId !== deviceId || body.deviceToken !== deviceToken || request.headers.authorization) return json(response, 401, { ok: false });
    metadata.pairValidated = true; publishMetadata();
    return json(response, 200, { ok: true, device: { id: deviceId, name: 'Synthetic loopback PC', expiresAt: '2099-01-01T00:00:00.000Z', testOnly: true, printAllowed: false } });
  }
  if (action === 'redirect') { response.writeHead(302, { Location: '/api/lab-connector?action=redirect-target', 'Content-Length': 0 }); response.end(); return; }
  if (action === 'redirect-target') return json(response, 200, { ok: true, unexpectedlyFollowed: true });
  if (action === 'unauthorized' || request.headers.authorization !== `Bearer ${deviceId}.${deviceToken}`) return json(response, 401, { ok: false });
  if (action === 'next') return json(response, 200, { ok: true, dispatch: null, testOnly: true, printAllowed: false });
  if (action === 'jpeg') { response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': payload.length }); response.end(payload); return; }
  if (action === 'declared-oversize') { const large = Buffer.alloc(96, 4); response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': large.length }); response.end(large); return; }
  if (action === 'chunked-oversize') { response.writeHead(200, { 'Content-Type': 'image/jpeg' }); response.write(Buffer.alloc(32, 1)); setImmediate(() => { response.write(Buffer.alloc(32, 2)); setImmediate(() => response.end(Buffer.alloc(32, 3))); }); return; }
  if (action === 'body-timeout') { response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); response.write(Buffer.from([1])); response.flushHeaders(); const timer = setTimeout(() => response.destroy(), 90000); response.on('close', () => clearTimeout(timer)); return; }
  if (action === 'unconfirmed') return json(response, 200, { ok: false });
  if (action === 'invalid-json') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{invalid'); return; }
  return json(response, 404, { ok: false });
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
server.on('clientError', (_, socket) => socket.destroy());
server.requestTimeout = 10000;
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw Error('Loopback binding failed.');
  metadata.port = address.port; publishMetadata();
  const ready = { fixtureVersion: 1, origin: `http://127.0.0.1:${address.port}`, pid: process.pid, deviceId, deviceToken, pairCode, payloadLength: payload.length, payloadSha256: createHash('sha256').update(payload).digest('hex') };
  const temporary = `${readyFile}.new`; fs.writeFileSync(temporary, JSON.stringify(ready)); fs.renameSync(temporary, readyFile);
});
const shutdown = () => { for (const socket of sockets) socket.destroy(); server.close(() => process.exit(0)); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
setTimeout(shutdown, 180000).unref();
