<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## NOA conversation architecture freeze

Until the new NOA conversation architecture migration is underway:

- Do not add natural-language phrase aliases to fix isolated UAT wording.
- Do not add new one-off clarification flags.
- Every new conversation failure must first be added to the golden multi-turn suite.
- Business capability truth must remain deterministic/provider-neutral.

## Module knowledge routing

For a new task, read [MODULE_ROUTER.md](docs/ai-knowledge/MODULE_ROUTER.md), then only the relevant module knowledge and named files and their direct dependencies. Do not rescan the entire repository. Preserve existing architecture and RLS, avoid unrelated refactors, and use focused validation. Update affected knowledge only when module architecture or contracts change; follow the router maintenance rules and verify mappings against the current branch.
