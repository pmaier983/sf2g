---
name: sf2g-swarm-templates
description: "Ready-to-use swarm templates for common sf2g project tasks. Use these templates when launching swarms for code review, feature implementation, refactoring, or research across the codebase. Also use when the user says 'swarm this', 'run a swarm', 'parallel agents', or wants to orchestrate multiple agents for an sf2g task."
---

# SF2G Swarm Templates

Pre-built swarm configurations for common tasks in this project. Copy and adapt these when launching swarms.

---

## Template 1: Codebase Analysis Swarm

Use when you need to understand the current state of the project deeply.

```
// 1. Define a research agent
define_subagent(
  name: "sf2g-scout",
  description: "Read-only research agent for sf2g codebase analysis",
  system_prompt: "You are a research specialist for the sf2g project — a cycling commute tracker built with TanStack Start, Supabase, and Strava OAuth. Read the specified files and report structured findings. Always start by reading /Users/phillipmaier/Desktop/Code/sf2g/GEMINI.md for project context.",
  enable_write_tools: false
)

// 2. Launch parallel scouts
invoke_subagent(Subagents: [
  {
    TypeName: "sf2g-scout",
    Role: "Route Classification Analyst",
    Prompt: "Read app/lib/route-classifier.ts, app/lib/constants.ts, and app/lib/destination-classifier.ts. Document: 1) The 3-layer classification system 2) All gateway checkpoints and their coordinates 3) Confidence scoring 4) Destination (office) classification 5) Any gaps or edge cases"
  },
  {
    TypeName: "sf2g-scout",
    Role: "Auth & Sync Analyst",
    Prompt: "Read app/server/auth.ts, app/lib/strava-oauth.ts, app/lib/session.ts, and app/server/sync.ts. Document: 1) Complete OAuth flow 2) Token storage and refresh 3) Session management 4) Sync strategy (incremental, rate limiting) 5) Error handling gaps"
  },
  {
    TypeName: "sf2g-scout",
    Role: "Database & Schema Analyst",
    Prompt: "Read all files in supabase/migrations/ and app/lib/database.types.ts. Document: 1) All tables, columns, and types 2) Relationships and foreign keys 3) RLS policies 4) Views (leaderboard_view, monthly_ride_stats) 5) Indexes"
  }
])
```

---

## Template 2: Feature Implementation Swarm

Use when building a new feature that spans database → server → client.

```
// Phase 1: Research (parallel)
invoke_subagent(Subagents: [
  {
    TypeName: "sf2g-scout",
    Role: "Existing Patterns Researcher",
    Prompt: "Research how existing features are structured in sf2g. Read: 1) A route page (app/routes/leaderboard.tsx) 2) A server function (app/server/leaderboard.ts) 3) A component (app/components/LeaderboardTable.tsx). Document the patterns used: createServerFn, data fetching, component structure."
  },
  {
    TypeName: "sf2g-scout",
    Role: "Schema Impact Analyst",
    Prompt: "Analyze whether the feature [DESCRIBE FEATURE] requires database changes. Read supabase/migrations/ and app/lib/database.types.ts. Report: 1) New tables/columns needed 2) RLS policy requirements 3) Whether existing views need updating"
  }
])

// Phase 2: Implement (sequential, after research)
invoke_subagent(Subagents: [
  {
    TypeName: "self",
    Role: "Feature Implementer",
    Prompt: "Implement [FEATURE]. Read the research findings above. Follow the project conventions in GEMINI.md. Build bottom-up: 1) Database migration (if needed) 2) Server functions in app/server/ 3) Query options in app/queries/ 4) Components in app/components/ 5) Route page in app/routes/. Run `pnpm typecheck` after each layer."
  }
])

// Phase 3: Review (parallel)
invoke_subagent(Subagents: [
  {
    TypeName: "sf2g-scout",
    Role: "Code Quality Reviewer",
    Prompt: "Review all files changed in the last commit. Read .agent/skills/code-review/SKILL.md for the full checklist. Report findings in 🔴/🟡/🟢 format."
  },
  {
    TypeName: "sf2g-scout",
    Role: "Security Reviewer",
    Prompt: "Review all files changed in the last commit for security issues. Check for: exposed secrets (VITE_ prefix on server-only vars), missing input validation on createServerFn, incorrect Supabase client usage (anon for writes), XSS in rendered user data."
  }
])
```

---

## Template 3: Bug Fix Swarm

Use when fixing multiple bugs in a batch.

```
// Phase 1: Research all bugs in parallel
invoke_subagent(Subagents: [
  {
    TypeName: "sf2g-scout",
    Role: "Bug 1 Investigator",
    Prompt: "Investigate: [BUG 1 DESCRIPTION]. Find the root cause. Read relevant files. Report: 1) Root cause 2) Affected files 3) Proposed fix 4) Risk level (low/medium/high)"
  },
  {
    TypeName: "sf2g-scout",
    Role: "Bug 2 Investigator",
    Prompt: "Investigate: [BUG 2 DESCRIPTION]. Find the root cause. Read relevant files. Report: 1) Root cause 2) Affected files 3) Proposed fix 4) Risk level (low/medium/high)"
  },
  {
    TypeName: "sf2g-scout",
    Role: "Bug 3 Investigator",
    Prompt: "Investigate: [BUG 3 DESCRIPTION]. Find the root cause. Read relevant files. Report: 1) Root cause 2) Affected files 3) Proposed fix 4) Risk level (low/medium/high)"
  }
])

// Phase 2: Synthesize and plan (you, the orchestrator)
// → Create an implementation plan artifact
// → Order fixes by risk (safest first)
// → Get user approval

// Phase 3: Fix sequentially (one commit per bug)
// For each bug in order:
invoke_subagent(Subagents: [
  {
    TypeName: "self",
    Role: "Bug Fixer",
    Prompt: "Fix [BUG]. Apply the approved solution: [SOLUTION]. Files to change: [FILES]. After fixing, run `pnpm typecheck` to verify. Then commit: `git add . && git commit -m 'fix: [description]'`"
  }
])
```

---

## Template 4: Code Review Swarm

Use for comprehensive multi-perspective review of a PR or set of changes.

```
invoke_subagent(Subagents: [
  {
    TypeName: "sf2g-scout",
    Role: "TypeScript Quality Reviewer",
    Prompt: "Review the git diff (run `git diff main`). Focus on TypeScript quality: type safety, no `any`/`as`, proper error handling, named exports, boolean prefixes. Use 🔴/🟡/🟢 severity format."
  },
  {
    TypeName: "sf2g-scout",
    Role: "Security & Auth Reviewer",
    Prompt: "Review the git diff (run `git diff main`). Focus on security: secrets exposure, input validation, correct Supabase client (service vs anon), session handling, OAuth flow integrity. Use 🔴/🟡/🟢 severity format."
  },
  {
    TypeName: "sf2g-scout",
    Role: "Architecture & Patterns Reviewer",
    Prompt: "Review the git diff (run `git diff main`). Read .agent/references/sf2g-architecture.md first. Focus on: correct file placement, server/client boundary, route classification patterns, CSS custom property usage. Use 🔴/🟡/🟢 severity format."
  }
])
```

---

## Template 5: Route Classification Tuning Swarm

Use when adding new gateways or adjusting classification parameters.

```
// Phase 1: Analyze current state
invoke_subagent(Subagents: [
  {
    TypeName: "sf2g-scout",
    Role: "Gateway Coverage Analyst",
    Prompt: "Read app/lib/constants.ts. List all ROUTE_GATEWAYS with their coordinates and categories. Then read app/lib/route-classifier.ts. For each route category (bayway, skyline, hmbw, royale), report: 1) Number of gateways 2) Geographic spread 3) Potential gaps in coverage"
  },
  {
    TypeName: "sf2g-scout",
    Role: "Classification Accuracy Analyst",
    Prompt: "Read app/server/reclassify.ts and app/lib/route-classifier.ts. Analyze: 1) How reclassification works 2) What the confidence thresholds are 3) How many rides fall into 'other' category 4) Suggestions for improving accuracy"
  }
])

// Phase 2: Implement changes based on analysis
invoke_subagent(Subagents: [
  {
    TypeName: "self",
    Role: "Classification Engineer",
    Prompt: "Based on the analysis: [FINDINGS]. Add/modify gateways in app/lib/constants.ts. Update classification logic in app/lib/route-classifier.ts if needed. Run `pnpm typecheck` and verify with the reclassify endpoint."
  }
])
```

---

## Template 6: Documentation Audit Swarm

Use when documentation needs updating after significant code changes.

```
invoke_subagent(Subagents: [
  {
    TypeName: "sf2g-scout",
    Role: "GEMINI.md Auditor",
    Prompt: "Read GEMINI.md and compare against the actual codebase. Check: project structure tree accuracy, command accuracy (pnpm dev, etc), environment variable list, design decisions section. Report discrepancies."
  },
  {
    TypeName: "sf2g-scout",
    Role: "Architecture Doc Auditor",
    Prompt: "Read .agent/references/sf2g-architecture.md and compare against actual code. Check: route table accuracy, server function inventory, database schema accuracy, component list. Report discrepancies."
  },
  {
    TypeName: "sf2g-scout",
    Role: "README Auditor",
    Prompt: "Read README.md and compare against actual project state. Check: setup instructions work, commands are correct, tech stack is accurate. Report discrepancies."
  }
])
```

---

## Tips for Effective Swarms

1. **Always include file paths** in prompts — subagents don't inherit your context
2. **Tell scouts to read GEMINI.md first** — it has all project conventions
3. **Use `sf2g-scout`** (read-only) for research, **`self`** for implementation
4. **3–5 parallel agents** is the sweet spot — more adds coordination overhead
5. **Sequential phases** for writes — don't have multiple agents writing simultaneously with `inherit` workspace
6. **Synthesize between phases** — combine scout findings before launching coders
