/**
 * Strava webhook event processing.
 *
 * The webhook only RECORDS work: one SQL call (enqueue_webhook_event,
 * migration 041) and the request is acknowledged. Fetching the activity,
 * classifying it and writing the ride happen later in the sync queue drain
 * (app/server/sync-drain.ts), where a slow Strava response or a CPU spike
 * can't cost the event — previously all of that ran before the 200, and a
 * 1102 there dropped the event.
 */
import { createServiceClient } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Strava webhook event payload */
export interface StravaWebhookEvent {
  /** 'activity' or 'athlete' */
  object_type: string;
  /** 'create', 'update', or 'delete' */
  aspect_type: string;
  /** Activity ID (for activity events) or athlete ID (for athlete events) */
  object_id: number;
  /** Strava athlete ID of the event owner */
  owner_id: number;
  /** Your webhook subscription ID */
  subscription_id: number;
  /** Unix epoch timestamp of the event */
  event_time: number;
  /** Changed fields (for updates) or {authorized: 'false'} for deauth */
  updates: Record<string, string>;
}

export interface WebhookProcessResult {
  event_type: string;
  action_taken: string;
  success: boolean;
  error?: string;
}

/**
 * Record a Strava webhook event. Never throws: Strava disables subscriptions
 * that keep failing, so errors are returned in the result instead.
 */
export async function processWebhookEvent(
  event: StravaWebhookEvent,
): Promise<WebhookProcessResult> {
  const eventType = `${event.object_type}.${event.aspect_type}`;

  const expectedSubscription = process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
  if (
    expectedSubscription &&
    String(event.subscription_id) !== expectedSubscription
  ) {
    console.warn(
      `[webhook] Ignoring event for subscription ${event.subscription_id}`,
    );
    return {
      event_type: eventType,
      action_taken: "ignored_subscription",
      success: true,
    };
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("enqueue_webhook_event", {
      p_object_type: event.object_type,
      p_aspect_type: event.aspect_type,
      p_object_id: event.object_id,
      p_owner_id: event.owner_id,
      p_updates: event.updates ?? {},
    });
    if (error) {
      console.error(
        `[webhook] enqueue failed for ${eventType}: ${error.message}`,
      );
      return {
        event_type: eventType,
        action_taken: "error",
        success: false,
        error: error.message,
      };
    }
    return { event_type: eventType, action_taken: String(data), success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] Error recording ${eventType}: ${message}`);
    return {
      event_type: eventType,
      action_taken: "error",
      success: false,
      error: message,
    };
  }
}
