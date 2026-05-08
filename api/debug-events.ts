import { getSupabaseServer } from './_supabase';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from('payment_events')
      .select('id,name,evento,data,stripe_session_id,customer_id,email')
      .order('data', { ascending: false })
      .limit(10);
    if (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); return; }
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ rows: data }));
  } catch (err: any) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err?.message || 'unknown_error' }));
  }
}
