## Docs Editorial Checklist

- [ ] Does this change add/remove MCP tools? If yes, update `tools/*` so `scripts/docs-guardrails.mjs` passes.
- [ ] If tools changed, update the vendored snapshot at `tooling/mcp-tools.json` (used by CI guardrails).
- [ ] Does this change affect storage, permissions, or “read-only” claims? If yes, update `/how-it-works`, `/ad-platforms/overview`, and `/ad-platforms/meta`.
- [ ] Does this mention an unlaunched capability? If yes, mark it **Coming Soon** and update `/feature-availability`.
- [ ] No pricing tables/tiers/prices were added to the docs.
- [ ] Lovable setup screenshots in `images/step-1.png`–`images/step-4.png` were preserved (not deleted or replaced).
