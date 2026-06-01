---
name: code-review
description: "Review TypeScript/React code for formatting, style, and correctness issues. Use this skill when the user asks to review code, check for issues, run a pre-commit review, or wants a second pair of eyes on their changes. Also use when the user mentions 'review', 'check my code', or asks if their code is ready to push."
---

# Code Review

Review changed files against the project's coding standards. For each violation, cite the file, line number, the offending code, and a concrete fix. Organize output by severity.

Before reviewing, read `.agent/references/sf2g-architecture.md` for the full system context.

---

## Step 1 — Collect the Changes

Determine scope based on what the user specifies:

- If specific files are given, review those directly.
- If no files specified, run `git diff --stat` and `git diff` to get changes.
- If the user says "staged", use `git diff --cached`.
- If a branch is specified, use `git diff <branch>...HEAD`.

---

## Step 2 — Review Checklist

For each changed file, check every category:

### TypeScript

- [ ] Uses TypeScript (no `.js` for new source)
- [ ] `const` over `let` wherever possible
- [ ] No type assertions (`as`) — use type guards, `satisfies`, or runtime validation. Exception: `as const`
- [ ] No `any` types — use `unknown` and narrow
- [ ] Arrow functions preferred: `const foo = () => {}` over `function foo() {}`
- [ ] Named exports over default exports
- [ ] Boolean variables prefixed with `is` or `has`
- [ ] Positive equality checks preferred: `=== 'expected'` over `!== 'other'`
- [ ] Nested ternaries avoided — use IIFE or early returns instead

### React / TanStack

- [ ] Server functions use `createServerFn` from `@tanstack/react-start`
- [ ] Routes use TanStack Router file-based conventions
- [ ] Data fetching uses TanStack Query (`queryOptions`, `useSuspenseQuery`)
- [ ] No `useEffect` without a header comment explaining why it's necessary
- [ ] No state updates in the component body (causes infinite re-renders)
- [ ] `useState` initializers don't depend on async or delayed values

### CSS / Styling

- [ ] Uses vanilla CSS with custom properties — no CSS-in-JS, no Tailwind
- [ ] Uses `var(--color-*)` tokens — never hardcoded colors
- [ ] Uses `rem` over `px` (exceptions: media queries, border-radius)
- [ ] Respects `data-theme` for dark/light mode
- [ ] No inline styles — put styles in CSS files or `<style>` blocks

### Supabase / Database

- [ ] Reads use anon client (`createAnonClient()`)
- [ ] Writes use service client (`createServiceClient()`) — never anon for mutations
- [ ] Error handling for all Supabase queries
- [ ] Uses typed `database.types.ts` — regenerate after schema changes
- [ ] No raw SQL in application code — use Supabase query builder

### Security

- [ ] No secrets in client-side code (no `SUPABASE_SERVICE_ROLE_KEY` in `VITE_*` vars)
- [ ] Session cookies are HTTP-only and signed
- [ ] OAuth state parameter validated on callback
- [ ] Input validation on all `createServerFn` inputs via `inputValidator`
- [ ] Rate limiting on sync endpoints

### Architecture

- [ ] Server-only logic in `app/server/`, not in routes or components
- [ ] Shared utilities in `app/lib/`, not duplicated
- [ ] Route classification uses gateway checkpoints — NOT Strava segment IDs
- [ ] New components go in `app/components/`
- [ ] SQL migrations go in `supabase/migrations/`

---

## Step 3 — Common Issues

### 3.1 Missing Error Handling on Supabase Calls

```typescript
// ❌ Ignores errors
const { data } = await supabase.from('rides').select('*')

// ✅ Always check for errors
const { data, error } = await supabase.from('rides').select('*')
if (error) {
  throw new Error(`Failed to fetch rides: ${error.message}`)
}
```

### 3.2 Client-Side Secrets

```typescript
// ❌ Service role key exposed to client
const VITE_SERVICE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

// ✅ Server-only — no VITE_ prefix
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
```

### 3.3 Incorrect Supabase Client for Writes

```typescript
// ❌ Anon client for writes — will be blocked by RLS
const supabase = createAnonClient()
await supabase.from('rides').insert(ride)

// ✅ Service client for writes
const supabase = createServiceClient()
await supabase.from('rides').insert(ride)
```

### 3.4 Missing Input Validation on Server Functions

```typescript
// ❌ No input validation
export const syncRides = createServerFn({ method: 'POST' })
  .handler(async () => { ... })

// ✅ Validate inputs
export const syncRides = createServerFn({ method: 'POST' })
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data }) => { ... })
```

---

## Step 4 — Format the Review Output

Organize findings by severity:

### 🔴 Must Fix
Issues that could cause bugs, security vulnerabilities, or data loss.
Format: `**[file:line]** — Description and suggested fix`

### 🟡 Should Fix
Style guide violations or patterns that deviate from conventions.
Format: `**[file:line]** — Description and suggested fix`

### 🟢 Suggestions
Optional improvements for readability or performance.
Format: `**[file:line]** — Suggestion`

### ✅ What Looks Good
Briefly call out things done well.

---

## Step 5 — Summary

End with:
- Total issues found (by severity)
- Whether the change is ready to push
- Any follow-up actions (e.g., "run `pnpm typecheck`", "add migration")
