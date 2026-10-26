/**
 * Compares the migrations in `supabase/migrations` with those applied to the
 * local database, from `supabase migration list --local --output-format json`.
 *
 * One local Supabase stack is shared by every checkout and worktree of this
 * repo, so it often carries another branch's migrations (or lacks this
 * branch's). The db tests then fail in confusing ways (extra columns in
 * snapshots, missing RPCs); the global setup uses this to reset instead.
 */

/** One row of the CLI's list: `local` = file on disk, `remote` = applied. */
export interface MigrationListEntry {
  local: string;
  remote: string;
}

export interface MigrationDrift {
  /** Versions with a file in this checkout that the database has not applied. */
  missing: string[];
  /** Versions the database has applied that have no file in this checkout. */
  extra: string[];
}

export function migrationDrift(entries: MigrationListEntry[]): MigrationDrift {
  const missing: string[] = [];
  const extra: string[] = [];
  for (const { local, remote } of entries) {
    if (local && !remote) missing.push(local);
    else if (remote && !local) extra.push(remote);
  }
  return { missing, extra };
}

export function hasDrift({ missing, extra }: MigrationDrift): boolean {
  return missing.length > 0 || extra.length > 0;
}

export function describeDrift({ missing, extra }: MigrationDrift): string {
  const parts: string[] = [];
  if (missing.length) parts.push(`not applied: ${missing.join(", ")}`);
  if (extra.length)
    parts.push(`applied but not in this checkout: ${extra.join(", ")}`);
  return parts.join("; ");
}

/**
 * Parses the CLI's stdout. The JSON object is the last line; anything before
 * it (progress text, update notices) is ignored. Returns null when no JSON
 * object is found so callers can treat the check as inconclusive.
 */
export function parseMigrationList(
  stdout: string,
): MigrationListEntry[] | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start)) as {
      migrations?: Array<Partial<MigrationListEntry>>;
    };
    if (!Array.isArray(parsed.migrations)) return null;
    return parsed.migrations.map((m) => ({
      local: m.local ?? "",
      remote: m.remote ?? "",
    }));
  } catch {
    return null;
  }
}
