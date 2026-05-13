# Agent F — UX Pre-session (web)

**Branch:** `feat/ux-presession`

You implement the React screens that come before a session starts:
templates picker, casting, persona library/editor.

## Scope (files you own)

- `apps/web/src/screens/templates/**` (port the existing mockup)
- `apps/web/src/screens/casting/**` (new)
- `apps/web/src/screens/personas/**` (new — library + editor)
- `apps/web/src/lib/api-client.ts` (new — tiny fetch wrapper)
- `apps/web/src/components/Pre*` (use the `Pre*` prefix for any shared components you add to `components/`, so Agent G's components don't collide)

## Off-limits

- `packages/shared/**` (frozen; import types only)
- `apps/server/**`
- `apps/web/src/screens/session/**` (Agent G)
- `apps/web/src/App.tsx` (router edits are orchestrator-only; you add screens, the router gets wired at Phase 2)
- `apps/web/src/main.tsx`, `apps/web/src/theme.css` (Phase 0 owns these; you can extend theme tokens by creating your own CSS files)

## What you build

### Templates picker

Port `mockups/templates/index.html` to a React component at `apps/web/src/screens/templates/index.tsx`. Match the paper aesthetic faithfully — type, color palette (use vars from `theme.css`), card layout, the side-by-side Debate + Roundtable cards, the recent-sessions strip, the persona-library hint footer.

Wire it to the server:
- On mount, fetch `GET /templates` (mock until the server has it — your `api-client.ts` should handle the not-implemented case gracefully). For v1, hardcode the two templates client-side if the server endpoint isn't ready.
- Each template card has a "Use" button that navigates to `/casting?template=<id>`.

### Casting screen

`apps/web/src/screens/casting/index.tsx` — after a template is picked, the user assembles the cast:

- Display the template's constraints (e.g., Debate needs at least one Pro and one Con seat).
- Browse the persona library (from `GET /personas` — mock if needed) and add seats. For each seat: pick a persona, assign a role (constrained by the template), pick a runtime (managed-agents | claude-code | human — the latter is the "you" seat).
- Scenario field (prompt for the kickoff).
- Length: open-ended or N rounds.
- Submit button: validates the cast against the template, POSTs to `POST /sessions` (mock the server response if needed; the response will include a `session_id`), then navigates to `/session/<id>`.

You don't need the server to be working — mock the API responses on the client. The orchestrator wires real endpoints at Phase 2.

### Persona library + editor

`apps/web/src/screens/personas/index.tsx` — list view of personas with name, role hint, voice signature snippet, edit/delete buttons, "+ New persona" button.

`apps/web/src/screens/personas/edit.tsx` — edit/create form for a `PersonaSpec` (from `@ensemble/shared/persona`): name, system prompt (large textarea), role, voice signature, buzz-in policy, tools allowed (multiselect from a known list of tool names — you can hardcode `["web_search", "memory.read", "memory.write"]` for now), memory policy (radio: ephemeral / session-scoped / persistent).

The form should validate against the Zod schema and surface errors.

For v1, store personas via `GET/POST/PUT/DELETE /personas/:id` (mock on client). Sample data: ship 3-4 default personas hardcoded in `api-client.ts` so the screen has content.

### api-client.ts

Tiny `fetch` wrapper with typed methods:

```ts
export const api = {
  templates: { list(): Promise<Template[]> },
  personas: { list(): Promise<PersonaSpec[]>, get(id): ..., save(spec): ..., delete(id): ... },
  sessions: { create(req): Promise<{session_id: string}> },
};
```

Each method first tries the real endpoint; on 404/501/network error, falls back to a hardcoded mock response. Document this dual-mode behavior.

### Styling

You can add additional CSS files alongside your components (e.g., `templates/templates.css`). Use existing theme tokens. Keep the paper aesthetic — match the mockups exactly.

### Components prefix

If you build shared components for pre-session screens, prefix file names with `Pre` (e.g., `apps/web/src/components/PreCard.tsx`) so they don't collide with Agent G's `Session*` components.

## Test obligations

- **L1 component tests:** for each screen, a smoke test that renders with mock data and asserts the right structural elements appear (use `@testing-library/react` if you want; or write minimal DOM assertions with happy-dom or jsdom under `bun test`).
- **L5 Playwright:** `e2e/templates-picker.spec.ts` — open the app, the template grid renders, each card has title + description + cast count, clicking one navigates to `/casting?template=<id>` with the right pre-fill. Document any prerequisites for running.
- **Snapshot tests** for the template grid in loading and empty states.

## HANDOFF.md must include

- Integration edits: the orchestrator needs to add your screens to the React router in `apps/web/src/App.tsx`. List the exact route → component mapping.
- Document the API contract you're calling so Agent A's server-side implementation can match (e.g., "the casting screen posts `{template_id, scenario, cast: [...], length}` to `POST /sessions`").
- Note: orchestrator merges this branch SIXTH.

## Acceptance

- `bun run typecheck` clean.
- `bun test` green for `apps/web`.
- `bun --filter @ensemble/web dev` renders templates picker at `/` (or `/templates`) with the paper aesthetic.
- Mock-mode functionality works end-to-end (pick template → fill cast → submit → console-logs the request shape).
- L5 templates-picker.spec.ts exists.
