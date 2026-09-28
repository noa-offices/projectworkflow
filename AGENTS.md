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
