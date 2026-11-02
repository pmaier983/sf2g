#!/usr/bin/env bash
# Start the local Supabase stack in CI, retrying when the first attempt fails.
#
# Two failure modes seen on GitHub-hosted runners, both transient:
#   - image pulls from public.ecr.aws answer "toomanyrequests" (anonymous
#     pulls are rate-limited per source IP, and runners share IPs);
#   - after a failed start, the half-created db container keeps port 54322,
#     so the CLI's own retry fails with "address already in use".
# `supabase stop --no-backup` clears the second before each retry.
set -uo pipefail
cd "$(dirname "$0")/../.."

attempts=3
for attempt in $(seq 1 "$attempts"); do
  if pnpm db:start; then
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::pnpm db:start failed (attempt $attempt of $attempts); stopping the half-started stack and retrying"
    supabase stop --no-backup || true
    sleep $((attempt * 30))
  fi
done

echo "::error::pnpm db:start failed after $attempts attempts"
exit 1
