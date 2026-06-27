Persona Command Center — Core Definition

Purpose

Persona Command Center is a local-first, SQLite-backed intelligence and review dashboard that helps users gather persona-specific signals, import Hermes briefings, review and score intelligence, generate/edit drafts, and prepare scheduled posts.

Nothing more.
Nothing less.


The Vibe Target

Persona Command Center should feel like a clean, responsive command center for managing multiple personas. It combines:
- A modern dashboard for signal review and velocity monitoring
- A persistent operator workflow for turning signals into high-quality drafts and scheduled posts
- Tight integration with Hermes as an external intelligence service

The experience must be fast, reliable, and fully local-first — everything persists in SQLite, survives restarts, and works without external API credentials during Phase 5.


The Core Promise

Persona Command Center allows a user (or operator) to:
- Maintain clean persona configurations with search terms
- Receive high-quality, scored signals via Hermes (or local providers)
- Review signals with velocity context
- Generate, refine, and approve drafts
- Prepare posts for scheduling with full audit trail

All while keeping full control and data ownership locally. Hermes provides intelligence; the Command Center owns persistence, review workflow, and the local operator loop.


Project Definition

Persona Command Center consists of:
- A single-file HTML frontend served by a minimal Node.js backend
- SQLite as the single source of truth for personas, signals, drafts, schedules, and audit events
- Provider-backed ingestion (RSS/news first) with scoring, deduplication, and clustering
- A deterministic Velocity Alert Engine
- A Phase 5 local operator loop for review → draft → quality check → approve/reject → schedule → manual publish/performance tracking

Hermes is treated as an external service. The app never calls external LLMs directly and does not require X (or other platform) API credentials in current phases.


Independence & Local-First

- All state lives in SQLite (`data/persona-command-center.sqlite`)
- No shared global memory between personas except through explicit signal history and velocity snapshots
- Persona edits and query changes take effect immediately without restarts
- The system must remain fully functional offline after initial setup (except for optional Hermes calls)


Loop & Workflow Engineering

The app supports both manual review and automated flows:
- Hermes morning digest, velocity scan, midday brief, evening scan
- Local operator loop: signal review → draft generation → A/B choice → quality checks → approval with reasons → scheduling preparation → manual mark-as-published + performance capture

Every automated or manual action must be auditable.


User Experience

The dashboard must feel responsive and intuitive. Key flows include:
- First-run persona setup
- Persistent persona + search term editing
- Daily Brief with velocity alerts
- Signal explorer and history
- Operator queue for draft review and scheduling
- Full audit trail

Switching between personas or reviewing signals must be fast. The app must remain stable under sustained use.


Runtime First

Persona Command Center is judged by its runtime behavior. A feature exists only if it works reliably in practice. Clean code, tests, or architecture are not substitutes for a smooth, reliable user experience and correct persistence.


Version 1 Success

Persona Command Center Version 1 is complete when a user can reliably:

- Complete first-run setup with multiple personas and search terms
- Run provider-backed Hermes morning digest and see scored signals
- Review signals with velocity context and history
- Generate, edit, approve/reject drafts with reasons
- Prepare scheduled posts and manually track publish + performance
- Maintain full audit history
- Persist all changes across browser refreshes and server restarts
- Run all verification scripts successfully


Version 1 Failure

The project has not achieved Version 1 if any of the following are true:

- Persona or signal data does not persist reliably
- Hermes import/attribution pipeline fails or loses metadata
- Velocity alerts or scoring are inconsistent
- The operator loop breaks (drafts, approval reasons, scheduling, manual publish)
- The app becomes unresponsive or requires frequent restarts
- First-run setup or manual editing flows are broken


Design Principle

Every engineering decision should answer one question: Does this improve Persona Command Center’s ability to deliver a reliable, local-first persona intelligence and operator workflow?

If the answer is no, it is not part of Version 1.


Definition of Done

Persona Command Center 1.0 is complete when a user can replace fragmented tools (spreadsheets, notes, multiple dashboards) with one reliable local Command Center that turns Hermes intelligence into reviewed, drafted, and scheduled content for multiple personas — with full persistence and auditability.