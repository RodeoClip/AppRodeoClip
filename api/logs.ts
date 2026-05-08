export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    console.log('[app_log]', body);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false }));
  }
}
