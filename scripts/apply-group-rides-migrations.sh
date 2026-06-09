#!/bin/bash
# ============================================================
# Apply Group Rides Migrations (025 + 026)
# ============================================================
# Run this script after linking your Supabase project:
#   npx supabase link --project-ref <YOUR_PROJECT_REF>
#
# Usage:
#   bash scripts/apply-group-rides-migrations.sh
# ============================================================

set -euo pipefail

echo "🔍 Checking Supabase link..."
if ! npx supabase projects list > /dev/null 2>&1; then
  echo "❌ Supabase CLI not authenticated. Run: npx supabase login"
  exit 1
fi

echo ""
echo "📦 Applying migration 025: Power & HR columns..."
npx supabase db push --include-all 2>&1 || {
  echo ""
  echo "⚠️  db push failed. Trying direct SQL execution..."
  echo "   You can also run these manually in the Supabase SQL Editor:"
  echo "   1. supabase/migrations/025_power_hr_columns.sql"
  echo "   2. supabase/migrations/026_ride_streams.sql"
  exit 1
}

echo ""
echo "✅ Migrations applied!"
echo ""
echo "🔄 Regenerating TypeScript types..."
npx supabase gen types typescript --linked > app/lib/database.types.ts
echo "✅ Types regenerated!"
echo ""
echo "🎉 Done! You can now run: pnpm dev"
