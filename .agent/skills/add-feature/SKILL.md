---
name: add-feature
description: "Structured workflow for adding a new feature to the sf2g app — from planning through implementation to commit. Use this skill when the user wants to add a new page, component, server function, database table, or any significant new functionality. Also use when the user says 'add a feature', 'build this', 'implement this', or describes new functionality they want."
---

# Add Feature

A structured workflow for adding new features to the sf2g project.

## Overview

1. **Understand** — Clarify requirements and scope
2. **Plan** — Design the solution and identify affected layers
3. **Implement** — Build layer by layer (database → server → client)
4. **Verify** — Type-check, test, review

## Phase 1: Understand

Before writing code, confirm:

- **What** is the feature?
- **Where** does it fit in the existing app? (new route? new component? server function?)
- **Who** sees it? (all users? logged-in only? dev tools?)
- **What data** does it need? (existing tables? new tables? Strava API?)

## Phase 2: Plan

### Identify the layers

| Layer | File Location | When Needed |
|-------|--------------|-------------|
| Database | `supabase/migrations/NNN_*.sql` | New tables, columns, or views |
| Types | `app/lib/database.types.ts` | After schema changes (`pnpm db:types`) |
| Server | `app/server/*.ts` | New `createServerFn` functions |
| Queries | `app/queries/*.ts` | TanStack Query option factories |
| Components | `app/components/*.tsx` | Reusable UI pieces |
| Routes | `app/routes/*.tsx` | New pages |
| Styles | `app/styles/*.css` | New CSS |
| Lib | `app/lib/*.ts` | Shared utilities |

### Create the plan

Present a concise plan as an artifact with:

- Files to create/modify (with links)
- Database changes (if any)
- Dependencies between files
- Any open questions

Wait for user approval before implementing.

## Phase 3: Implement

Build bottom-up through the stack:

### 3.1 Database (if needed)

Create a new migration:

```sql
-- supabase/migrations/NNN_description.sql
CREATE TABLE IF NOT EXISTS new_table (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: Public reads, service role writes
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON new_table
  FOR SELECT USING (true);
```

Then regenerate types: `pnpm db:types`

### 3.2 Server Functions

Create server functions in `app/server/`:

```typescript
import { createServerFn } from '@tanstack/react-start'
import { createServiceClient } from '../lib/supabase'

export const myFunction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const supabase = createServiceClient()
    // ... server logic
  })
```

### 3.3 Query Options (if data fetching)

Create query option factories in `app/queries/`:

```typescript
import { queryOptions } from '@tanstack/react-query'
import { myFunction } from '../server/my-domain'

export const myQueryOptions = (params: { id: string }) =>
  queryOptions({
    queryKey: ['my-domain', params.id],
    queryFn: () => myFunction({ data: params }),
  })
```

### 3.4 Components

Create components in `app/components/`:

```tsx
interface MyComponentProps {
  data: SomeType
}

export const MyComponent = ({ data }: MyComponentProps) => {
  return (
    <div className="my-component">
      {/* ... */}
    </div>
  )
}
```

### 3.5 Routes

Add new routes in `app/routes/`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/my-page')({
  component: MyPage,
  // Optional: loader for server-side data
  loader: async () => {
    // ...
  },
})

function MyPage() {
  return (
    <div className="page">
      {/* ... */}
    </div>
  )
}
```

### 3.6 Styles

Add styles in `app/styles/components.css` or a new CSS file:

```css
.my-component {
  padding: 1rem;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  border-radius: 0.5rem;
}
```

## Phase 4: Verify

1. **Type-check**: `pnpm typecheck`
2. **Dev server**: `pnpm dev` — verify in browser
3. **Code review**: Run the `.agent/skills/code-review/SKILL.md` skill
4. **Commit**: `git add . && git commit -m "feat: <description>"`
