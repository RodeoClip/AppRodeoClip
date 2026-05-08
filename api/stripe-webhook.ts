import Stripe from 'stripe';
import { getSupabaseServer } from './_supabase';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const secret = process.env.STRIPE_SECRET_KEY || '';
    if (!sig || !webhookSecret || !secret) {
      res.statusCode = 400;
      res.end('Missing signature or secret');
      return;
    }
    const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });
    const event: any = await stripe.webhooks.constructEventAsync(raw, sig as string, webhookSecret);
    switch (event.type as string) {
      case 'checkout.session.created': {
        const session: any = event.data.object;
        console.log('checkout.session.created', { id: session.id, mode: session.mode });
        try {
          const supabase = getSupabaseServer();
          await supabase.from('payment_events').insert({
            name: session?.customer_details?.name || null,
            email: session?.customer_details?.email || null,
            evento: 'checkout.session.created',
            stripe_session_id: session.id,
            customer_id: session?.customer || null,
            metadata: { mode: session?.mode }
          });
        } catch {}
        break;
      }
      case 'checkout.session.completed': {
        const session: any = event.data.object;
        console.log('✅ checkout.session.completed', { id: session.id, status: session.status });
        try {
          const supabase = getSupabaseServer();
          await supabase.from('payment_events').insert({
            name: session?.customer_details?.name || null,
            email: session?.customer_details?.email || null,
            evento: 'checkout.session.completed',
            stripe_session_id: session.id,
            customer_id: session?.customer || null,
            metadata: { status: session?.status }
          });
        } catch {}
        break;
      }
      case 'payment_intent.succeeded': {
        const intent: any = event.data.object;
        console.log('💰 payment_intent.succeeded', { id: intent.id, amount: intent.amount });
        try {
          const supabase = getSupabaseServer();
          await supabase.from('payment_events').insert({
            name: null,
            email: null,
            evento: 'payment_intent.succeeded',
            stripe_session_id: null,
            customer_id: intent?.customer || null,
            metadata: { amount: intent?.amount, currency: intent?.currency }
          });
        } catch {}
        break;
      }
      default:
        console.log('ℹ️ Evento recebido:', event.type);
    }
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ received: true }));
  } catch (err) {
    console.error('❌ Verificação de assinatura falhou:', err);
    res.statusCode = 400;
    res.end('Webhook error');
  }
}
