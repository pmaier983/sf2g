/**
 * Playwright global setup: same database preparation as the Vitest db
 * project — fixtures loaded, materialized views refreshed, group rides
 * computed — so pages that read derived data have something to show on a
 * fresh `supabase start` (CI).
 */
import setupDatabase from "../app/test/db-global-setup";

export default async function globalSetup(): Promise<void> {
  await setupDatabase();
}
