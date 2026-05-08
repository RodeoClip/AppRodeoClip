import Stripe from 'stripe';
import { getSupabaseServer } from './_supabase';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const sessionId = url.searchParams.get('session_id');
    const secret = process.env.STRIPE_SECRET_KEY || '';
    if (!secret || !sessionId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'missing_params_or_secret' }));
      return;
    }
    const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });
    const session: any = await stripe.checkout.sessions.retrieve(sessionId);
    const isPaid = session?.payment_status === 'paid' || session?.status === 'complete';
    if (isPaid) {
      try {
        const supabase = getSupabaseServer();
        await supabase.from('payment_events').insert({
          name: session?.customer_details?.name || null,
          email: session?.customer_details?.email || null,
          evento: 'verify.session.paid',
          stripe_session_id: sessionId,
          customer_id: (session as any)?.customer || null,
          metadata: { mode: session?.mode }
        });
      } catch {}
    }
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ isPaid, mode: session?.mode, customer: session?.customer, subscription: session?.subscription }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'verify_failed' }));
  }
}
