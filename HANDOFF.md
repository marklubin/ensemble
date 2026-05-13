# HANDOFF — Agent F (feat/ux-presession)

## What works

- **Templates picker** at `/` (`apps/web/src/screens/templates/index.tsx`).
  - Ports `mockups/templates/index.html` to React: paper-aesthetic top bar,
    "A new scene" lead, side-by-side Debate + Roundtable cards with their
    illustrations, the "custom format" row, the recent-sessions strip, and
    the persona-library footer hint.
  - Fetches `GET /templates` and `GET /personas` via `api-client.ts`; if the
    server isn't up the client falls back to two hardcoded templates and
    four hardcoded personas so the screen has content.
  - Selecting a card highlights it; "Use Debate / Use Roundtable" navigates
    to `/casting?template=<id>`.
- **Casting screen** at `/casting?template=<id>`
  (`apps/web/src/screens/casting/index.tsx`).
  - Loads the template by id; renders a constraints panel that ticks/crosses
    each requirement (min/max cast, required roles) live as the cast changes.
  - Seat rows: persona picker (from `/personas`), role picker (constrained to
    the template's `required_roles`), runtime picker
    (`managed-agents | claude-code | human`), remove button.
  - For Debate, seats are pre-seeded with one `Pro` and one `Con` row.
  - Scenario textarea (label/placeholder vary by `scenario_format`).
  - Length: open-ended or N rounds.
  - Submit is disabled until the cast validates against the template AND a
    scenario is set; on submit it `POST /sessions` and navigates to
    `/session/<session_id>`.
- **Persona library** at `/personas`
  (`apps/web/src/screens/personas/index.tsx`).
  - List view with name, role, voice signature snippet, memory policy badge,
    Edit + Delete buttons, "+ New persona" CTA.
- **Persona editor** at `/personas/new` and `/personas/:id`
  (`apps/web/src/screens/personas/edit.tsx`).
  - Form for the full `PersonaSpec`: name, role, system prompt, voice
    signature, buzz-in policy, tools allowed (chip multiselect over
    `["web_search", "memory.read", "memory.write"]`), memory policy radio.
  - Validates against the Zod schema on save; ids on creation are slugified
    from the name.
- **Tiny API client** (`apps/web/src/lib/api-client.ts`) with dual-mode
  behaviour: tries the real endpoint first, falls back to hardcoded mock data
  on `404 / 501 / network error`. In-memory persona store backs save/delete
  during mock-only runs.

## What's stubbed

- `apps/web/src/screens/templates/index.tsx`: `RECENT_SESSIONS` and
  `PAST_COUNTS` constants are hardcoded (no `/sessions/history` endpoint yet).
  TODO: wire to a real history endpoint when one exists.
- `apps/web/src/screens/templates/index.tsx`: "Build custom" button is
  disabled (custom-template builder is post-v1).
- `apps/web/src/lib/api-client.ts`: when `POST /sessions` 404/501s, the
  client synthesizes a `session_id` like `mock-<random>` and `console.log`s
  the full request shape so the orchestrator and server agent can verify the
  payload contract.
- `apps/web/src/components/PreTopBar.tsx`: "History" and "Settings" buttons
  are non-functional placeholders (mirrors the mockup).

## Env vars consumed

None. The dev server proxies `/templates`, `/personas`, `/sessions` to
`localhost:4111` already (Phase 0 setup in `apps/web/vite.config.ts`); the
api-client just falls back to mocks when those endpoints 404.

## Integration edits required at Phase 2

The orchestrator owns `apps/web/src/App.tsx`. Add these imports and routes:

```tsx
// At the top of apps/web/src/App.tsx:
import { TemplatesScreen } from "./screens/templates/index.tsx";
import { CastingScreen } from "./screens/casting/index.tsx";
import { PersonasScreen } from "./screens/personas/index.tsx";
import { PersonaEditScreen } from "./screens/personas/edit.tsx";

// Inside <Routes>, replace the four placeholder pre-session routes with:
<Route path="/" element={<TemplatesScreen />} />
<Route path="/casting" element={<CastingScreen />} />
<Route path="/personas" element={<PersonasScreen />} />
<Route path="/personas/new" element={<PersonaEditScreen />} />
<Route path="/personas/:id" element={<PersonaEditScreen />} />
```

(`/session/:id` is Agent G's; leave that route alone.)

The Phase 0 placeholder `<header>` element at the top of `App.tsx` overlaps
visually with the pre-session screens' own `<PreTopBar>`. The orchestrator
can either remove that placeholder header entirely or keep it — both work.
Recommendation: remove it once Agent G's session screen also has its own
top bar.

## API contract this branch calls

The casting screen and persona screens hit the following routes. Each
gracefully falls back to client-side mocks on `404 / 501 / network error`.

### `GET /templates → Template[]`

Returns the array of `Template` (Zod schema in
`packages/shared/src/template.ts`). v1 ships exactly two: `debate` and
`roundtable`.

### `GET /personas → PersonaSpec[]`

Returns the array of `PersonaSpec`
(`packages/shared/src/persona.ts`).

### `GET /personas/:id → PersonaSpec | 404`

### `POST /personas` and `PUT /personas/:id`

Body: a `PersonaSpec`. Response: the saved `PersonaSpec`. (Create vs.
update is decided client-side by whether the id already exists in the
library.)

### `DELETE /personas/:id → 200 | 404`

### `POST /sessions → { session_id: string }`

Request body shape (see `CreateSessionRequest` in `api-client.ts`):

```ts
{
  template_id: string;
  scenario: string;
  cast: Array<{
    seat_id?: string;          // client-side stable id
    persona_id: string;
    role?: string;             // matches a template required_role.role
    runtime_type: "managed-agents" | "claude-code" | "human";
  }>;
  length: { kind: "open-ended" } | { kind: "n-rounds"; rounds: number };
}
```

Response: `{ session_id: string }`. The client then navigates to
`/session/<session_id>`.

## Types proposed for shared

- `CreateSessionRequest` (in `apps/web/src/lib/api-client.ts`) describes the
  exact `POST /sessions` payload the casting screen emits. Agent A's server
  needs the same shape. **Recommended action at Phase 2:** promote this to
  `packages/shared/src/api.ts` and have both the client and server import it.

## Tests delivered

| Test file | Level | Covers |
|---|---|---|
| `apps/web/src/lib/api-client.test.ts` | L1 | Dual-mode fetch wrapper: mock fallback on network error / 404 / 501, live pass-through on 200, persona save/delete round-trip in mock store, session create returns a synthetic id when server is missing. |
| `apps/web/src/screens/templates/TemplateGrid.test.tsx` | L1 (snapshot) | Three states of the grid: `loading` (skeleton cards), `empty` (helpful copy), `populated` (template cards + use buttons + past-session counts). Snapshots in `__snapshots__/`. |
| `apps/web/src/screens/templates/index.test.tsx` | L1 smoke | Templates screen renders the lead heading, both default templates, both "Use" buttons, and the persona library count. |
| `apps/web/src/screens/casting/index.test.tsx` | L1 smoke | Loads the Debate template and shows constraints; missing template id shows the not-found path; submit disabled until valid. |
| `apps/web/src/screens/personas/personas.test.tsx` | L1 smoke | Persona library lists default personas; persona editor disables Save until name + system prompt are present. |
| `e2e/templates-picker.spec.ts` | L5 (Playwright) | Templates grid renders with name + tagline + cast count on each card; clicking "Use" navigates to `/casting?template=<id>`. **Prerequisite:** routes must be wired in `App.tsx` per the Integration section above, plus `bun x playwright install chromium` for the browser. |

Test infra notes:

- `apps/web/test/setup-dom.ts` registers happy-dom globally for DOM tests.
  It's preloaded by both `bunfig.toml` (root) and `apps/web/bunfig.toml`, and
  each test file imports it defensively so tests work from either CWD.
- `bunfig.toml` at the repo root ignores `e2e/**` so `bun test` doesn't try
  to load Playwright specs.

## New dependencies added

| Package | Version | Reason | Where |
|---|---|---|---|
| `happy-dom` | ^20.9 | DOM implementation for L1 component tests. | apps/web devDeps |
| `@happy-dom/global-registrator` | ^20.9 | Globally register happy-dom from a preload script. | apps/web devDeps |
| `@testing-library/react` | ^16.3 | Render React in tests. | apps/web devDeps |
| `@testing-library/dom` | ^10.4 | Peer of @testing-library/react. | apps/web devDeps |
| `@playwright/test` | ^1.60 | Playwright for L5 E2E. | root devDeps |
| `playwright` | ^1.60 | Playwright browser drivers. | root devDeps |

## Acceptance gate status

- `bun run typecheck` — clean across the workspace.
- `bun test` — 14 pass / 0 fail (apps/web only; root-level is also green
  with `bunfig.toml` ignore rules).
- `bun --filter @ensemble/web dev` — boots; with the route patch above the
  templates picker renders at `/` and proxies stay configured for Agent A's
  server.
- L5 spec exists at `e2e/templates-picker.spec.ts` (run with
  `bun x playwright test`; requires `bun x playwright install chromium` and
  the router wiring above).
- Snapshot tests exist for the template grid in loading / empty / populated
  states.
