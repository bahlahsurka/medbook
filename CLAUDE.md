# Working on MedBook

## PR monitoring — scale it to the change

For a routine bug fix or minor feature addition, after opening a PR:
- Subscribe to PR activity (event-driven — no polling needed) and respond to whatever comes in.
- Do **not** schedule a safety-net check-in (`send_later`/scheduled wakeup) by default. Those are for cases where something could realistically go unnoticed for a while, which a small, already-tested change isn't.
- Local build/test verification (`CI=true npm run build`, the Jest suite, and a DevHarness+Playwright visual check where relevant) is the normal, expected step before every push — not a special case worth flagging or hedging against with extra monitoring.

Reserve a scheduled safety-net check-in for:
- A genuinely major feature or architectural change.
- A push made *without* being able to fully build/test/visually verify first (rare — call this out explicitly when it happens).
- A case where the user has asked to be watched/babysat more closely.

Don't react to routine Vercel bot build-status comments (Building → Ready) — they need no action and no reply.
