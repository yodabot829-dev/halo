# Project × Skills Map

Surveyed 2026-07-02 from each repo's `.claude/`, `.mcp.json`, manifests, and docs.

Baseline for every project (global, always available): superpowers workflow skills
(brainstorming, TDD, systematic-debugging, verification), `code-review`,
`security-review`, `planner`/`architect`/`tdd-guide` agents, git workflow.
The table lists what's *specific* to each project beyond that baseline.

| Project | Stack | Project-level assets | Key global skills | MCPs · CLIs · Services |
|---|---|---|---|---|
| **halo** | TS monorepo — Fastify core, React+Vite web, Vercel AI SDK, SQLite | none yet | `claude-api`, `voicemode`, `obsidian*` (vault memory), `impeccable`, `dataviz`, `context7` | Ollama, Infisical, whisper.cpp, Kokoro, claude/codex CLIs |
| **PropertyInvestiQ** (AIProjects) | React (CRA) + Python FastAPI + Supabase | skill `impeccable`; agent `onboarding-reviewer`; workflows `go-live-gate-audit`, `tier-rerate`, `competitor-gap-analysis` | `supabase`, `stripe:*`, `python-patterns`/`python-testing`, `e2e`, `seo-audit` | **supabase MCP**; Supabase/Stripe/Netlify/Render/Resend/Infisical CLIs; Sentry |
| **trading-bot** | Python FastAPI + Alpaca + pandas; Next.js frontend; Kronos ML vendor | CLAUDE.md only | `python-patterns`, `python-testing`, `dataviz` | Alpaca, Telegram, Docker, Ollama; launchd services |
| **cortana** | Python CLI — anthropic, faster-whisper, elevenlabs, sounddevice | none | `voicemode`, `python-patterns`, `claude-api` | ElevenLabs (paid TTS), Whisper, mic hardware |
| **journeyforce-website** | Next.js + Tailwind + MDX + three.js | CLAUDE.md only | `frontend-patterns`, `copywriting`, `seo-audit`, `theme-factory`, `impeccable` | Vercel CLI; n8n (via journeyforce scripts) |
| **journeyforce-dashboard** | Python FastAPI + Jinja2 + SQLAlchemy + APScheduler | none | `python-patterns`, `backend-patterns` | Telegram bot, GeoIP2/MaxMind |
| **leadgen-agent** | Python agent — anthropic, telegram, APScheduler, feedparser | none | `python-patterns`, `pm2`, `copywriting`, `claude-api` | Telegram, **PM2**, .env |
| **faceless-youtube** | Remotion (React video) + TS; Python whisper | none (superpowers specs/plans in docs/) | `frontend-patterns`, `canvas-design`/`theme-factory`, `huashu-design` | Remotion, FFmpeg, Whisper, YouTube |
| **salesforce-accelerators** | TS CLI generator (tsx + Vitest) | none | **`/sf`**, `coding-standards` | Salesforce `sf`/sfdx CLI |
| **gemmawatch** (OpusWatch) | Python + Claude Agent SDK (autonomous weekly reviewer) | none (worktrees only) | `claude-api`, `obsidian*`, `mem-search` | Claude Agent SDK (Max auth), Telegram, Obsidian vault, Salesforce |

## Cross-cutting

- **Telegram** appears in 5 projects (trading-bot, journeyforce-dashboard, leadgen-agent, gemmawatch, halo-to-be) — the strongest argument for HALO absorbing one shared channel layer.
- **Whisper/voice** in 3 (halo, cortana, faceless-youtube) — cortana's paid ElevenLabs is replaceable by HALO's free Kokoro pipeline.
- **Language split**: Python ×5 (trading-bot, cortana, jf-dashboard, leadgen, gemmawatch), TypeScript/Node ×5 (halo, jf-website, sf-accelerators, faceless-youtube, PropertyInvestiQ frontend); PropertyInvestiQ and trading-bot are hybrid.
- **Gaps worth closing**: 8/10 projects have no project-level CLAUDE.md (only trading-bot + jf-website do); only PropertyInvestiQ declares an `.mcp.json`. Scaffolding a minimal CLAUDE.md + skills pointer per project would make every repo self-describing — and let HALO's Projects view display required skills per card.
