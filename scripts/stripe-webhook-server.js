import http from 'http';
import Stripe from 'stripe';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: '.env.local' });

const port = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT, 10) : 4242;
const webhookPath = '/api/stripe-webhook';
const createCheckoutPath = '/api/create-checkout';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
if (!webhookSecret) {
  console.error('STRIPE_WEBHOOK_SECRET não definido em .env.local');
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = new Stripe(stripeSecretKey || 'sk_test_placeholder', {
  apiVersion: '2024-11-20',
});

const getRawBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  const pathOnly = (req.url || '').split('?')[0];
  
  // CORS preflight for create-checkout
  if (req.method === 'OPTIONS' && pathOnly === createCheckoutPath) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    res.end();
    return;
  }

  // Create Checkout Session
  if (req.method === 'POST' && pathOnly === createCheckoutPath) {
    let rawBody;
    try {
      rawBody = await getRawBody(req);
    } catch (err) {
      console.error('Falha ao ler corpo (create-checkout)', err);
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }
    const headersCors = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    };
    try {
      const data = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
      const priceId = data.priceId || process.env.STRIPE_PRICE_ID;
      if (!priceId) {
        res.writeHead(400, headersCors);
        res.end(JSON.stringify({ error: 'Missing priceId' }));
        return;
      }
      const successUrl = process.env.STRIPE_SUCCESS_URL || 'http://localhost:3011/?success=true&session_id={CHECKOUT_SESSION_ID}';
      const cancelUrl = process.env.STRIPE_CANCEL_URL || 'http://localhost:3011/?canceled=true';
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      res.writeHead(200, headersCors);
      res.end(JSON.stringify({ id: session.id, url: session.url }));
    } catch (err) {
      console.error('Erro ao criar checkout session:', err);
      res.writeHead(500, headersCors);
      res.end(JSON.stringify({ error: 'create_session_failed' }));
    }
    return;
  }
  
  // Webhook verification path
  if (req.method !== 'POST' || pathOnly !== webhookPath) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    console.error('Falha ao ler corpo bruto da requisição', err);
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || !webhookSecret) {
    console.error('Assinatura Stripe ou segredo do webhook ausente');
    res.statusCode = 400;
    res.end('Missing signature or secret');
    return;
  }

  try {
    const event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('✅ checkout.session.completed', { id: session.id, status: session.status });
        break;
      }
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        console.log('💰 payment_intent.succeeded', { id: intent.id, amount: intent.amount });
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
});

server.listen(port, () => {
  console.log(`Stripe webhook server rodando em http://localhost:${port}${webhookPath}`);
  console.log('Use o Stripe CLI para encaminhar eventos:');
  const cliPath = process.env.STRIPE_CLI_PATH || 'stripe';
  console.log(`${cliPath} listen --events checkout.session.completed,payment_intent.succeeded --forward-to http://localhost:${port}${webhookPath}`);
});
