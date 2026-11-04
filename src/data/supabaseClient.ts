import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  ?? ''

export const isSupabaseConfigured = supabaseUrl.length > 0 && supabasePublishableKey.length > 0

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null
