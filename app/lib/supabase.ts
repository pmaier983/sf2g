/**
 * Supabase client factory.
 *
 * Two clients:
 * - `createAnonClient()` — respects RLS policies, use for public reads
 * - `createServiceClient()` — bypasses RLS, use for server-side writes (sync, auth)
 *
 * NEVER expose `createServiceClient()` to client code.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * ANON client — respects RLS policies. Use for public reads.
 */
export function createAnonClient(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
  }

  return createClient<Database>(url, key)
}

/**
 * SERVICE ROLE client — bypasses RLS. Use for server-side writes (sync, auth).
 * NEVER expose to client code.
 */
export function createServiceClient(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
  }

  return createClient<Database>(url, key)
}
