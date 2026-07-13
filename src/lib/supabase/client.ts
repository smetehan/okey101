import { createClient } from "@supabase/supabase-js";

// Tarayıcı tarafı: sadece game_public okur + realtime dinler + ses sinyalleşmesi
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { realtime: { params: { eventsPerSecond: 20 } } }
);
