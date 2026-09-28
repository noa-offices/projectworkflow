# NOA canonical test mode (Phase 0B)

`npm run test:noa` uses tsx and node:test with process isolation and module mocks. Its offline preload replaces native fetch and blocks Socket.connect (including native HTTP/TLS clients) before application imports. Test-specific fetch/provider stubs may run, but cannot make real network connections. No paid/live provider, auth or Supabase calls are required or permitted.

## Golden and route acceptance boundary

- Real imports: orchestrator, deterministic prerouter/router, reference validators/binders/builders, semantic resolvers, V1/V2 extractor implementations, spoken-response formatter, shared client state helpers, realtime transcript normalizer.
- Runtime configuration is stubbed to disabled/no key. V1 executes its real disabled fallback (`Unclear`); `semanticUsed` means the extractor was invoked, not that an LLM ran or supplied a usable result. V2 and agents flags are explicitly false for the golden baseline. Provider-router invocation throws. Answer generation is bypassed by fixture `deterministicOnly` data.
- Project, Quotation and UserActivity capabilities are seeded substitutes, including their exported identifier/entity lookup helpers. Product candidate resolution is a no-match stub; Product capability execution throws as unseeded. Other capability implementations are not fixture coverage; database access throws if reached.
- The route test imports the real POST and NextResponse. Its only database stub permits auth/getUser and the caller profile lookup; route validation and orchestrator execution remain real. There is no actual authentication/RLS assurance from this test.
- The previous harness did not explicitly disable semantic/provider execution and left Product candidate lookup real. Help fallbacks hit request-scope errors, hidden by TODO tests. These infrastructure gaps are now closed without changing production routing.

## What canonical tests prove

Golden tests pin routing, scope, reference replacement and multi-turn outcomes for deterministic fixture reads with semantic runtime disabled. A-D assert CURRENT wrong decisions, and must be deliberately promoted during migration. They do not prove live model language understanding, provider quality, database query truth, access control, or related-result execution. In particular, the two generic active projects happen to equal the linked fixture projects: scope/binding assertions, not matching row IDs or prose, diagnose D.

Existing semantic V2 tests exercise real pure validation, grounding, eligibility and resolver functions with constructed semantic objects, plus source-level wiring checks. Existing provider/extractor safety tests inspect source; they do not exercise a live provider. Some legacy capability/voice suites still transpile or extract small functions with injected dependencies. Phase 0B does not convert that entire legacy suite. No second live/failing baseline command is added.

## State and trace contracts

The client and harness share wholesale successful reference replacement, error preservation, error text and ordered six-message projection. The harness starts with the same greeting, records user/error turns and serializes requests. Product configuration survives unrelated turns only when the server reattaches it; cancellation clears it. Local UI-only draft prompts and audio lifecycle are outside the harness.

The opt-in orchestrator collector uses request-local AsyncLocalStorage; it is not session storage or telemetry. It does not alter NoaAnswer. Collector errors cannot change answers. Only closed enums, booleans, counts and elapsed milliseconds are emitted. Error codes never use Error.name/message.

`scopeSource`: explicit_identifier, conversation_reference, page_context, generic_query, clarification, none. `referenceBindingKind` uses the existing closed binder kinds plus legacy_follow_up/finding. `capabilitySelected` is null for a Help fallback even though its answer domain is Help. `resultCount` counts structured capability rows/items (or a Project detail), not prose; unsupported shapes remain null. The collector observes existing decisions; it does not add routing rules. Guided configuration/agent internals are not new capability-level trace coverage.

Phase 1C added a separate, session-scoped shadow trace (`sessionMode`, `shadowResultKind`, `shadowResultEntityType`, `shadowSave` - see noa-shadow-turn.ts), carried alongside this collector's fields, never merged into `scopeSource`/`referenceBindingKind`. Same safety rule: closed enums/counts only, never a session id, ResultSet handle, or business identifier.

## Phase 1 status (1A-1E, complete)

Server-side session state (`noa_sessions`, live and RLS-verified), shadow ResultSet capture on every turn, and a deterministic relation/aggregate-drill-down foundation (`noa-relation.server.ts`) all exist and are exercised by the canonical suite. None of it is read by routing yet - `scopeSource`/`capabilitySelected`/the golden A-E baselines above are unchanged from Phase 0B, by design. Phase 2 introduces the first conversational consumer (a Semantic Planner) that reads shadow ResultSets/relations to actually change what NOA answers; until then this is inert, provider-neutral infrastructure only.

Realtime transcript tests call the actual voice normalizer before shared chat routing. Noah/Nova greeting corrections are supported; filler removal and spoken business-ID repair are not. No microphone, audio or TTS is exercised.

## Cleanup evidence

Both `.tmp-focused-tests/` and `.tmp-planner-tests/` contained generated CommonJS JavaScript and copied MJS tests (27 files total), with maintained TypeScript sources under lib. A hidden-file-inclusive repository reference search excluding node_modules, .git, .next and the two output directories found no references in npm scripts, tests or developer workflows before deletion. Neither directory had tracked changes.
