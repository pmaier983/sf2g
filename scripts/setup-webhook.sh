#!/bin/bash
# =============================================================================
# Strava Webhook Subscription Management
# =============================================================================
#
# Usage:
#   ./scripts/setup-webhook.sh create   — Create a new webhook subscription
#   ./scripts/setup-webhook.sh view     — View existing subscription(s)
#   ./scripts/setup-webhook.sh delete   — Delete an existing subscription
#
# Prerequisites:
#   Set these environment variables (or they'll be read from .env.local):
#   - STRAVA_CLIENT_ID
#   - STRAVA_CLIENT_SECRET  
#   - STRAVA_WEBHOOK_VERIFY_TOKEN
#   - APP_URL (default: https://sf2ging.com)
#
# Note: Strava only allows ONE subscription per app.
#       You must delete the old one before creating a new one.
# =============================================================================

set -euo pipefail

# Try to load from .env.local if variables aren't set
if [ -f .env.local ]; then
  echo "Loading environment from .env.local..."
  set -a
  source .env.local
  set +a
fi

# Validate required variables
if [ -z "${STRAVA_CLIENT_ID:-}" ] || [ -z "${STRAVA_CLIENT_SECRET:-}" ]; then
  echo "❌ Error: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set"
  echo "   Set them as environment variables or in .env.local"
  exit 1
fi

APP_URL="${APP_URL:-https://sf2ging.com}"
CALLBACK_URL="${APP_URL}/api/webhook"

case "${1:-help}" in
  create)
    if [ -z "${STRAVA_WEBHOOK_VERIFY_TOKEN:-}" ]; then
      echo "❌ Error: STRAVA_WEBHOOK_VERIFY_TOKEN must be set"
      exit 1
    fi

    echo "🔔 Creating webhook subscription..."
    echo "   Callback URL: ${CALLBACK_URL}"
    echo ""

    curl -s -X POST https://www.strava.com/api/v3/push_subscriptions \
      -F "client_id=${STRAVA_CLIENT_ID}" \
      -F "client_secret=${STRAVA_CLIENT_SECRET}" \
      -F "callback_url=${CALLBACK_URL}" \
      -F "verify_token=${STRAVA_WEBHOOK_VERIFY_TOKEN}" | jq .

    echo ""
    echo "✅ Subscription created (if no error above)"
    ;;

  view)
    echo "📋 Viewing existing webhook subscription(s)..."
    echo ""

    curl -s -G https://www.strava.com/api/v3/push_subscriptions \
      -d "client_id=${STRAVA_CLIENT_ID}" \
      -d "client_secret=${STRAVA_CLIENT_SECRET}" | jq .
    ;;

  delete)
    echo "📋 Fetching existing subscription(s)..."
    SUBS=$(curl -s -G https://www.strava.com/api/v3/push_subscriptions \
      -d "client_id=${STRAVA_CLIENT_ID}" \
      -d "client_secret=${STRAVA_CLIENT_SECRET}")

    echo "$SUBS" | jq .

    # Extract subscription ID
    SUB_ID=$(echo "$SUBS" | jq -r '.[0].id // empty')

    if [ -z "$SUB_ID" ]; then
      echo "ℹ️  No subscriptions found to delete"
      exit 0
    fi

    echo ""
    read -p "Delete subscription ${SUB_ID}? (y/N) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
      curl -s -X DELETE "https://www.strava.com/api/v3/push_subscriptions/${SUB_ID}" \
        -d "client_id=${STRAVA_CLIENT_ID}" \
        -d "client_secret=${STRAVA_CLIENT_SECRET}"
      echo "✅ Subscription ${SUB_ID} deleted"
    else
      echo "Cancelled"
    fi
    ;;

  help|*)
    echo "Strava Webhook Subscription Manager"
    echo ""
    echo "Usage: $0 {create|view|delete}"
    echo ""
    echo "Commands:"
    echo "  create  — Create a new webhook subscription"
    echo "  view    — View existing subscription(s)"
    echo "  delete  — Delete an existing subscription"
    ;;
esac
