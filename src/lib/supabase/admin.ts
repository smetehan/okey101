import { createClient } from "@supabase/supabase-js";

// SADECE API route'larında kullanılır. Service role key'i asla
// NEXT_PUBLIC_ ile başlatmayın!
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
