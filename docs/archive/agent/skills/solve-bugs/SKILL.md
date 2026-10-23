---
name: solve-bugs
description: "Systematic workflow for fixing multiple bugs in a single session — research, propose, implement, and commit. Use this skill when the user asks to fix bugs, solve issues, batch-fix problems, or wants a structured approach to resolving several code issues at once. Also use when the user provides a list of issues, says 'fix these bugs', or wants to go through a bug list end-to-end with commits."
---

# Solve Bugs

A structured, multi-phase workflow for fixing a batch of bugs in a single session. Produces clean commits ready to push to GitHub.

## Overview

Three phases, executed strictly in order:

1. **Research** — Gather all context for every bug before writing any code
2. **Propose** — Present solutions and get user approval before implementing
3. **Implement** — Fix, verify, and commit each bug

This separation matters because early research often reveals dependencies between bugs that change the optimal fix order.

## Phase 1: Research

For each bug in the list, spin up a research subagent to work in parallel:

1. **Read the bug** — Parse the description, steps to reproduce, and any discussion.
2. **Find relevant code** — Search the codebase for affected files. Read the components, server functions, utilities, and types involved.
3. **Check recent conversations** — Look through recent conversation summaries for any prior discussion.
4. **Identify scope** — Determine what files need to change, root cause, and whether shared code is involved.

### Research output

For each bug, produce:

- **Root cause** — What's actually wrong and why
- **Affected files** — Every file that needs to change
- **Dependencies** — Whether this bug depends on or conflicts with other bugs in the list
- **Risk assessment** — Low (isolated change), Medium (touches shared code), High (architectural)

## Phase 2: Propose

After research, create an **implementation plan artifact** for the user to review.

### The implementation plan should include:

1. **Fix order** — A table showing the proposed commit sequence, ordered by risk (safest first). Include description, risk level, and dependency notes.

2. **Per-fix details** — For each fix:
   - **What** will change and **why**
   - **Files** to modify, create, or delete (with links)
   - **Database changes** — any new migrations needed
   - **Key decisions** — non-obvious choices and rationale
   - **Risk factors** — what could go wrong

3. **Cross-fix dependencies** — Ordering constraints or shared code that multiple fixes touch.

Always set `RequestFeedback: true` on the artifact.

### Wait for approval

Do not proceed to Phase 3 until the user explicitly approves. They may:
- Reorder fixes
- Split or merge commits
- Modify solutions
- Ask clarifying questions

## Phase 3: Implement

For each fix, in the approved order:

### Step 1: Make the fix

Implement the approved solution following project conventions:

- TypeScript strict mode, named exports
- Vanilla CSS with custom properties
- `createServerFn` for server logic
- Supabase service client for writes, anon client for reads
- Input validation on all server functions

### Step 2: Type-check

```bash
pnpm typecheck
```

Fix any type errors before proceeding.

### Step 3: Run the code-review skill

Follow the `code-review` skill (`.agent/skills/code-review/SKILL.md`) against the changed files. Fix any issues it surfaces.

### Step 4: Test locally (if applicable)

```bash
pnpm dev
```

Verify the fix works in the browser if it's a UI change.

### Step 5: Commit

```bash
git add <changed-files>
git commit -m "<type>: <description>"
```

Commit message format:
- `fix: <description>` for bug fixes
- `feat: <description>` for new features
- `refactor: <description>` for code improvements
- `chore: <description>` for maintenance

### Step 6: Move to the next bug

Apply any learnings from the current fix to subsequent ones.

## After all bugs are fixed

Verify everything is clean:

```bash
# Check the commits
git log --oneline main..HEAD

# Verify types
pnpm typecheck

# Push when ready
git push
```

## Key Principles

- **Research everything before coding anything.** Cross-bug dependencies are common.
- **Get explicit approval.** The user may know context that changes the solution.
- **Order by risk.** Safe changes first, risky changes last.
- **Each commit should be independently buildable.** Don't introduce type errors in intermediate commits.
- **Learn as you go.** Patterns discovered in Bug 1 should inform Bug 3.
