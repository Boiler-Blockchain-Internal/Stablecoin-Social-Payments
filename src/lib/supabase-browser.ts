"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (anon key). READ-ONLY by design: RLS allows anon SELECT
 * and nothing else. All writes go through our API routes in src/app/api.
 * Also use this for realtime subscriptions on `requests` and `transactions`.
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
