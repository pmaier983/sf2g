/**
 * Growth chart bucket size for a date range:
 * - ≤ 90 days  → daily
 * - ≤ 365 days → weekly (Monday buckets)
 * - otherwise  → monthly
 */
export type Granularity = "daily" | "weekly" | "monthly";

export function detectGranularity(
  dateFrom?: string,
  dateTo?: string,
): Granularity {
  if (!dateFrom || !dateTo) return "monthly";
  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo}T00:00:00Z`);
  const diffDays = Math.round((to - from) / 86_400_000);
  if (diffDays <= 90) return "daily";
  if (diffDays <= 365) return "weekly";
  return "monthly";
}
