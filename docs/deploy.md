# Deployment & CI setup

One-time setup for production deploys and PR workflows. After this is
done, the workflows under `.github/workflows/` handle everything.

## Fly.io (deploys)

1. **Install flyctl** locally and log in:
   ```bash
   brew install flyctl
   fly auth login
   ```

2. **Create the app + volume** (once):
   ```bash
   cd /path/to/ensemble
   fly apps create ensemble
   fly volumes create ensemble_data --region sjc --size 1
   ```

3. **Set production secrets** (Fly stores them encrypted; never in
   the repo):
   ```bash
   fly secrets set \
     ANTHROPIC_API_KEY=sk-ant-... \
     JWT_SECRET="$(openssl rand -hex 32)" \
     CLAUDE_CODE_RUNTIME_ENABLED=false
   ```

4. **Mint a deploy token** for GitHub Actions and add it as a repo
   secret:
   ```bash
   fly tokens create deploy --name "github-actions" --expiry 9999h
   ```
   Copy the token, then in the GitHub repo settings →
   *Secrets and variables → Actions → New repository secret*:
   - Name: `FLY_API_TOKEN`
   - Value: (paste token)

5. First deploy manually to make sure everything works:
   ```bash
   fly deploy --remote-only
   ```

After that, every push to `main` triggers `.github/workflows/deploy.yml`
which gates the deploy on the full CI suite.

## Codex adversarial review

1. **Add an OpenAI API key as a repo secret.** Codex CLI uses the
   `OPENAI_API_KEY` env var.
   - GitHub repo settings → Secrets → Actions → New secret
   - Name: `OPENAI_API_KEY`
   - Value: a key that has access to the Codex models

2. That's it — `.github/workflows/codex-review.yml` runs automatically
   on every non-draft pull request, reads `.github/codex-review-prompt.md`,
   and posts the review as a PR comment.

## Branch protection (PR-only main)

After the first PR merges, enable a ruleset that requires PR review and
green CI on `main`:

```bash
gh api --method POST /repos/marklubin/ensemble/rulesets \
  --input - <<'EOF'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "pull_request",
      "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false } },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          {"context": "typecheck"},
          {"context": "test (server)"},
          {"context": "test (web)"},
          {"context": "e2e (playwright)"}
        ]
      }
    }
  ]
}
EOF
```

This requires CI to pass before merge; Codex review posts a comment but
doesn't block (it's advisory).

## What the workflows do

- **`ci.yml`** — typecheck + server tests + web tests + Playwright. Runs
  on every push and PR. Used as the deploy gate.
- **`deploy.yml`** — calls `ci.yml` as a sub-workflow, then deploys to
  Fly via `flyctl deploy --remote-only` (the Docker build happens on
  Fly's remote builders, not on the GitHub runner).
- **`codex-review.yml`** — runs the OpenAI Codex CLI against the PR diff
  with `.github/codex-review-prompt.md`, posts the verdict + findings
  as a PR comment. Advisory; doesn't block merge.
