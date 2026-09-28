@AGENTS.md

# ProjectWorkflow — Claude Development Guide

## Project

ProjectWorkflow is a B2B quotation/specification/project ERP built with:

- Next.js
- TypeScript
- Supabase/Postgres
- Supabase Auth + RLS
- Vercel

NOA is ProjectWorkflow's conversational assistant.

The repository already contains substantial working business logic.
Do not redesign working business capabilities unless the task explicitly requires it.

---

# Development Priorities

1. Preserve existing architecture unless the task explicitly changes it.
2. Make the smallest safe change.
3. Prefer existing helpers/contracts over new abstractions.
4. Do not broad-refactor unrelated code.
5. Do not infer unsupported business data.
6. Authorization and business truth remain deterministic.
7. Never bypass Supabase RLS for convenience.
8. Prefer focused tests over full builds.
9. Stop and report a blocker rather than expanding task scope.

---

# Credit / Token Discipline

Cloud Claude sessions consume limited project credit.

Before broad exploration:

1. read this file
2. inspect `git status`
3. inspect only the files named in the task
4. inspect direct dependencies only when required
5. form an implementation plan
6. edit narrowly

Avoid:

- broad repository scans
- rereading unrelated modules
- speculative refactors
- large architectural essays during implementation
- repeated full test runs before focused tests pass
- full builds unless explicitly requested

When existing contracts already answer a design question, use them rather than rediscovering the architecture.

---

# NOA Architecture — Authoritative Direction

Phase 0 and Phase 1 are complete.

Current canonical architecture direction:

User text / voice transcript
→ normalization
→ small deterministic guard
→ server-side NOA session state
→ Semantic Planner
→ structural validation
→ deterministic authorized capability/tool
→ ResultSet/session update
→ deterministic natural renderer
→ optional grounded composer later

The LLM is used to interpret natural language.

The LLM does NOT own:
- authorization
- pricing
- business calculations
- database truth
- ResultSet validity
- relation validity
- write permissions

---

# NOA Phase 1 Foundation

The following already exists and should be reused.

## Session

`noa_sessions` stores server-side conversational state.

Important characteristics:

- owned by authenticated user
- RLS enabled
- optimistic concurrency version
- 30-minute idle expiry
- JSONB conversation state
- bounded state
- server repository handles load/create/save

Relevant modules include:

- `lib/noa/noa-session.server.ts`
- `lib/noa/noa-conversation-state.ts`

Do not replace this with client-managed state.

---

# ResultSet

ResultSets are first-class conversation scope.

Relevant module:

- `lib/noa/noa-result-set.ts`

Supported kinds:

- `entity`
- `list`
- `aggregate`

ResultSets store only safe stable identifiers and query metadata.

They do NOT cache business truth such as:
- names
- prices
- totals
- descriptions
- client financial data

Capabilities must re-fetch authoritative data.

Important limits:

- maximum 5 ResultSets in state
- maximum 50 references per ResultSet
- newest supported ResultSet becomes focus
- list display order is significant

"The second one" must refer to the second displayed item, not arbitrary DB order.

---

# Relations

Relevant modules:

- `lib/noa/noa-relation-registry.ts`
- `lib/noa/noa-relation.server.ts`

Current implemented relation:

`quotation → project_file`

The relation service:

- re-fetches authoritative rows
- respects RLS
- deduplicates targets
- preserves first-seen source/display order
- never trusts ResultSet IDs as authorization

Quotation aggregate drill-down also exists.

Example:

quotation status aggregate
+ `client_confirmed`
→ authoritative quotation list ResultSet

Do not duplicate this logic in the planner.

---

# Shadow State

Relevant module:

- `lib/noa/noa-shadow-turn.ts`

Phase 1 captures ResultSets in shadow state.

Until Phase 2 cutover:

- legacy routing remains authoritative
- ResultSets have not influenced current conversation routing

Phase 2 is the first allowed consumer of ResultSets.

---

# Semantic Planner Contract

The Semantic Planner is provider-neutral.

Its purpose is:

natural language + bounded conversation state
→ validated structured intent/tool request

Preferred flow:

Planner output
→ TypeScript validation
→ deterministic capability/relation execution

Never:

Planner output
→ direct DB operation

The planner must use strict structured output / native provider tool calling where supported.

Do not trust model-reported confidence.

Validation decides whether execution is safe.

Planner outputs should use closed values such as:

- tool/action identifier
- ResultSet handle
- relation identifier
- ordinal
- closed status/filter values

Never allow:
- arbitrary SQL
- arbitrary Supabase filters
- arbitrary tool names
- arbitrary ResultSet handles not present in state

---

# Planner Provider Independence

The planner may run through OpenAI, Gemini, or Anthropic using the existing AI provider abstraction.

Provider selection must not change:

- authorization
- ResultSet semantics
- relation semantics
- business data
- capability execution
- session state

Provider-specific behavior belongs only at the structured inference boundary.

Do not create separate business logic per provider.

---

# Current Phase 2 Pilot

Phase 2 begins with Quotations only.

Primary proof case:

1. User asks quotation status.
2. NOA returns status aggregate.
3. User asks which two are client-confirmed.
4. NOA returns the two quotation entities.
5. User asks which projects they belong to.
6. Planner must bind the existing quotation ResultSet.
7. Deterministic relation service executes:
   `quotation → project_file`
8. NOA returns only those related Project Files.

The current legacy bug performs a generic active-Project query at step 5.

Phase 2 must fix this through ResultSet planning, NOT through phrase-specific regex.

---

# Conversation Freeze Rule

Do NOT add new natural-language phrase aliases or one-off clarification flags to fix isolated UAT wording.

Every new conversation failure must first become a golden multi-turn test.

Natural-language variability belongs in the Semantic Planner.

Deterministic routing is reserved for cases where determinism adds value:

- exact business IDs
- explicit commands
- exact pending-choice tokens
- write confirmations
- security/safety boundaries

---

# Product Configuration

Product Configuration is a multi-step task/workflow.

It is NOT a normal ResultSet.

Do not force `ProductConfigurationReference` into the ResultSet abstraction unless a future explicit migration task requires it.

Preserve existing Product Configuration behavior.

---

# Voice

Voice ultimately feeds transcript text into the shared NOA conversation path.

Do not duplicate planner/business logic inside voice code.

TTS/STT provider architecture is separate from the Semantic Planner.

Do not modify voice/TTS unless the task explicitly requires it.

---

# Response Generation

For now prefer deterministic natural renderers.

Do not add a general LLM response composer during Phase 2 unless explicitly requested.

Structured business values should remain controlled by code.

---

# Testing

Canonical NOA command:

`npm run test:noa`

Current Phase 1 checkpoint was fully green.

Golden multi-turn tests are authoritative.

Tests should assert:

- planner decision
- capability/tool selected
- ResultSet handle/type
- relation selected
- bound scope
- resulting identifiers/counts
- state transition

Avoid asserting exact prose unless wording itself is the contract.

Canonical tests must make zero live calls to:

- Supabase
- OpenAI
- Gemini
- Anthropic

Live provider evals are separate.

Every newly discovered UAT failure becomes a golden test before it is fixed.

Also run:

- `npx tsc --noEmit`
- scoped ESLint
- `git diff --check`

Do not run a full build unless explicitly requested.

---

# Git / Cloud Session Workflow

Each Claude Code cloud task runs on its own branch.

For each task:

1. make only the requested changes
2. run focused validation
3. run `npm run test:noa`
4. commit all task changes
5. push the branch
6. open a PR
7. write a concise PR description containing:
   - goal
   - files changed
   - behavior changed
   - tests/checks
   - known limitations
   - follow-up work

Do not mix unrelated cleanup into the PR.

The user will review and merge the PR before the next cloud session begins.
