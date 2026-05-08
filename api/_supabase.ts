import { createClient } from '@supabase/supabase-js';

export function getSupabaseServer() {
  const url = process.env.SUPABASE_URL as string;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  if (!url || !serviceKey) throw new Error('missing_supabase_server_env');
  return createClient(url, serviceKey);
}
