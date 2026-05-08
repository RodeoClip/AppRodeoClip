import Stripe from 'stripe';
import { getSupabaseServer } from './_supabase';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    const priceId = body.priceId || process.env.STRIPE_PRICE_ID || (process.env as any)['ID_PREÇO_STRIPE'] || (process.env as any).ID_PRECO_STRIPE;
    const secret = process.env.STRIPE_SECRET_KEY || '';
    if (!secret) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'missing_stripe_secret' }));
      return;
    }
    if (!priceId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'missing_price_id' }));
      return;
    }
    const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });
    const successUrl = process.env.STRIPE_SUCCESS_URL || 'https://'+(req.headers.host || '')+'/?success=true&session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl = process.env.STRIPE_CANCEL_URL || 'https://'+(req.headers.host || '')+'/?canceled=true';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    try {
      const supabase = getSupabaseServer();
      await supabase.from('payment_events').insert({
        name: session?.customer_details?.name || null,
        email: session?.customer_details?.email || null,
        evento: 'checkout.session.created',
        stripe_session_id: session.id,
        customer_id: (session as any)?.customer || null,
        metadata: { mode: session?.mode, url: session?.url }
      });
    } catch {}
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ id: session.id, url: session.url }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'create_session_failed' }));
  }
}
