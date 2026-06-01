/**
 * User server functions.
 *
 * - `fetchUserProfile` — fetches a user's public profile by userId
 */
import { createServerFn } from '@tanstack/react-start'
import { createAnonClient } from '../lib/supabase'
import type { User } from '../lib/database.types'

// ---------------------------------------------------------------------------
// fetchUserProfile — fetches a user's public profile
// ---------------------------------------------------------------------------
export const fetchUserProfile = createServerFn({ method: 'GET' })
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data }): Promise<User> => {
    const supabase = createAnonClient()

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.userId)
      .single()

    if (error || !user) {
      throw new Error(
        `User not found: ${data.userId}`,
      )
    }

    return user
  })
