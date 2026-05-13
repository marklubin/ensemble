# Ensemble — Session Configuration Space

<!-- updated: 2026-05-12 -->

## Framing

A **session** is the unit. Sessions are configured points in an
N-dimensional config space. **Templates are named presets** in that
space — they pin specific values on most axes and surface only the few
that vary.

Custom sessions let you move any axis. Templates are scaffolding, not
walls.

---

## The Dimensions

### 1. Cast (always required)

A session is N personas drawn from your library, each in a seat.

| Sub-axis | Values | Notes |
|---|---|---|
| `personas` | ordered list of `persona_id` refs | from the library |
| `role` (per seat) | `none` \| custom string (e.g. `Pro`, `Con`, `Host`, `Guest`, `Defendant`) | drives behavior + display |
| `model_override` | provider/model, optional | otherwise inherits persona's default |
| `human_seat` | `null` \| seat index with role | is the human at the table, and where |
| `min_cast`, `max_cast` | int, optional | constraints (some presets force ≥2 Pro and ≥2 Con) |

Cast is *not* part of the template — same template, different cast. The
template constrains *what kinds of seats exist* and which are required.

### 2. Turn-taking (where the mechanic lives)

How is the next speaker chosen?

| Mode | Mechanic | Good for |
|---|---|---|
| `round-robin` | Fixed order, same every round | Standups |
| `shuffled` | Reshuffled each round | Roundtable, Debate (default in both baselines) |
| `host-driven` | One designated persona picks who's next | Interview, panel |
| `user-driven` | You click a persona to call on them | Director mode |
| `self-select` | After each turn, poll idle personas with current context; each returns an *interest score*. Highest score speaks next. Tie-break: longest-since-last-spoke, then random. | Natural conversation; lets personas opt out of turns they have nothing to add to |
| `interruption` | While a persona is streaming, run parallel "interrupt monitors" on idle personas with the in-flight text. If any returns intensity above threshold, cancel the stream and let them cut in. | Heated debate, improv |
| `hybrid` | `shuffled` rounds with `interruption` windows between speakers | The natural middle ground |

Sub-axes:
- `max_consecutive_turns` — can one persona go twice in a row? (default 1)
- `talking_stick` — can the moderator force a specific speaker out of order?
- `interrupt_threshold` (only when `interruption` mode) — 0–10
- `self_select_quiet_bias` — boost interest score for personas who haven't spoken in K turns

### 3. Moderation

The moderator/director/host/judge — whatever you want to call the
non-cast participant. Their config is its own little sub-tree.

| Sub-axis | Values |
|---|---|
| `present` | bool |
| `role` | `fact-checker` \| `host` \| `mediator` \| `judge` \| `director` \| `narrator` \| custom |
| `cadence` | `every-round` \| `on-demand` \| `start-and-end-only` \| `between-phases` \| `continuous` (can speak any time) |
| `tools_enabled` | `[web_search, calculator, citations, scoring, …]` |
| `visible_to_cast` | bool — does the cast see the moderator's messages in their context? (Director mode: false. Most others: true.) |
| `llm` | provider/model — independent from any cast member |
| `system_prompt` | editable string, with role defaults |

Role defaults wire up `tools_enabled` and `visible_to_cast` sensibly:
`fact-checker` enables web_search + visible; `director` disables tools + invisible.

### 4. Structure / Pacing

How long does a session run, and is it sliced into phases?

| Sub-axis | Values |
|---|---|
| `length` | `open-ended` \| `n_rounds=N` \| `until_consensus` \| `until_verdict` \| `until_artifact_complete` |
| `phases` | optional ordered list of `{name, turn_taking_override, length}`. E.g. debate: opening / body / cross-ex / closing |
| `per_turn_budget` | optional max_tokens or max_time per turn |
| `auto_run` | bool — auto-advance through rounds vs. manual "next round" button |

### 5. Context model

What does each persona see?

| Sub-axis | Values |
|---|---|
| `history_visibility` | `full` (everyone sees everything — current default) \| `phase-scoped` \| `private-pov` (each persona has a limited view) |
| `documents` | list of attached files; each tagged with `visibility` (`public` \| persona-subset) |
| `per_persona_scratchpad` | bool — private notes a persona maintains across turns |
| `per_persona_goal` | bool — private hidden objective injected into system prompt (negotiation mode) |
| `shared_artifact` | optional — a doc the cast collaboratively edits (writers' room) |

### 6. Conclusion

How does the session end, and what's the output artifact?

| Sub-axis | Values |
|---|---|
| `trigger` | `user-ends` \| `n-rounds-reached` \| `consensus-reached` \| `moderator-decides` \| `goal-met` |
| `synthesis` | `none` \| `summary` \| `verdict-with-winner` \| `deal-terms` \| `action-items` \| `score-card` |
| `synthesizer` | `moderator` \| `dedicated-judge-persona` \| `user` |
| `scoring` | bool — only valid when cast has assigned sides |

### 7. Scenario

The kickoff content.

| Sub-axis | Values |
|---|---|
| `prompt` | the kickoff text — the motion / question / situation |
| `format` | `motion` \| `question` \| `scenario-description` \| `document-discussion` \| `open` |
| `topic_mutable` | bool — can the user change the scenario mid-session? |

### 8. Human role

What can the human do during the session?

| Sub-axis | Values |
|---|---|
| `seat` | `spectator` \| `participant` (in a cast seat) \| `director` (controls speaker order, regenerate, branch) |
| `interrupt_enabled` | bool — when participant, can the human cut in mid-round? |
| `director_controls` | subset of `[next-speaker, regenerate, branch, topic-change, force-speaker, pause-stream]` |

Spectator + Director is a valid combination — you watch the cast play
without speaking, but you control the camera.

---

## How templates collapse into this space

### Debate

```yaml
cast:
  roles: required(Pro, Con)   # at least one of each
  min_cast: 2
turn_taking:
  mode: shuffled
  max_consecutive_turns: 1
moderation:
  present: true
  role: judge                  # fact-checker + final verdict
  cadence: every-round
  tools_enabled: [web_search]
  visible_to_cast: true
structure:
  length: n_rounds | open-ended
  phases: [opening, body, closing]   # optional
conclusion:
  trigger: user-ends | n-rounds
  synthesis: verdict-with-winner
  scoring: true
scenario:
  format: motion
human:
  seat: spectator (default) | participant
  interrupt_enabled: true
```

### Roundtable

```yaml
cast:
  roles: none
  min_cast: 2
turn_taking:
  mode: shuffled
moderation:
  present: false               # opt-in
structure:
  length: open-ended
conclusion:
  trigger: user-ends
  synthesis: summary
  scoring: false
scenario:
  format: open
human:
  seat: participant
  interrupt_enabled: true
```

### Future templates fall out cleanly

- **Interview**: `turn_taking: host-driven`, `cast.roles: Host + Guests`, no moderator, `conclusion.synthesis: summary`.
- **Writers' room**: `turn_taking: self-select`, no moderator, `shared_artifact: enabled`, `conclusion.synthesis: artifact-final`.
- **Negotiation**: `cast.roles: Side-A, Side-B (+ optional Mediator)`, `per_persona_goal: true`, `conclusion.synthesis: deal-terms`.
- **Standup**: `turn_taking: round-robin`, fixed length, `per_turn_budget: 30s`, no moderator.
- **Mock trial**: `cast.roles: Plaintiff, Defendant, Judge, Jury+`, structured phases, scoring at end.

---

## Recommended v1 scope

**Expose directly in v1 (Cast Call screen):**
1. Cast — personas + roles + human seat
2. Moderation — on/off + role + cadence
3. Turn-taking mode — `shuffled` and `self-select` to start (we ship both; everything else is future)
4. Scenario prompt + format
5. Length — open-ended vs. n-rounds
6. Conclusion synthesis — none/summary/verdict
7. Human seat — spectator vs. participant + interrupt toggle

**Defer for v1 (still in the model, defaulted, hidden behind "Advanced"):**
- Phases (default: none)
- Per-persona scratchpad / private goals
- History visibility variants (default: full)
- Shared artifact
- `interruption` and `hybrid` turn-taking (ship after `self-select` works)

**v0 defaults if a template doesn't specify:**
- turn_taking: `shuffled`
- moderation: off
- length: open-ended
- conclusion.synthesis: summary
- human.seat: participant
- history.visibility: full

---

## Notes on the interesting turn-taking modes

### self-select

After every turn, before choosing the next speaker:

1. Build a brief "what just happened" packet — last 1–3 turns of context.
2. For each idle persona, in parallel, prompt: *"You're \<Name\>. Here's what was just said. On a scale of 1–10, how strongly do you want to respond, and in one sentence, what would your contribution be? Return JSON: {score, intent}."*
3. Sort by score. Apply quiet bias if enabled. Tie-break random.
4. Top scorer speaks. Their `intent` becomes a hint in their system prompt for the actual turn — keeps them honest to what they signaled.

Cost: N extra small LLM calls per turn. Worth it — this is the mechanic
that makes the simulation feel *alive*. Use a cheap fast model for the
poll (Haiku 4.5 or similar).

### interruption

Run *during* a streaming turn:

1. As the active speaker streams, batch every ~3 seconds of streamed text.
2. For each idle persona, in parallel, prompt: *"You're \<Name\>. \<Active\> is currently saying: \"...\". Do you want to interrupt? Score 1–10 + one-sentence reason."*
3. If any persona scores above `interrupt_threshold` (default 8):
   - Cancel the active stream at the next chunk boundary.
   - Log `[Interrupted by Name]: <their reason as a half-line>`.
   - That persona becomes the next speaker.

Cost: higher (parallel polls during streaming). Implementation gotcha:
need a way to cancel an in-flight LLM stream cleanly. OpenAI and
Anthropic SDKs both support this.

---

## Open questions

1. Does **moderator presence** belong inside Moderation, or is the user
   really picking from a role list where "no moderator" is one option?
2. Should `interruption` be a turn-taking *mode* or an *overlay* that
   stacks on any base mode (e.g. shuffled + interruption windows)?
3. Phases: do we need them in v1 for the Debate template, or is "rounds"
   sufficient? (My guess: rounds is sufficient; phases are v2.)
4. Cast composition: are roles always picked at session start, or can
   personas swap roles mid-session?
5. Do scorecard / verdict synthesis need their own UI surface or are
   they just a long final moderator turn?
