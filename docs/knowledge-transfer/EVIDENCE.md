# Evidence, status and maintenance

**Inspected baseline:** `df9cf44f713e11c62add3786e6026aaee8022495` on `dev`, 2026-10-27. Package version 0.3.1.
This commit includes ADR-0030 implementation and the no-change final-action UI fix. Documentation
status files can lag implementation; this package names that discrepancy rather than rewriting
architecture authority.

## Claim labels

- **Implemented:** the relevant code path exists on the pinned baseline. Not a claim of production
  reliability or proof that every configuration succeeds.
- **Historical:** evidence from an earlier screenshot/code snapshot. Current fixes are named.
- **Open risk:** a mechanism exists, but occurrence rate and token impact are not measured.
- **Proposed:** an engineering recommendation or roadmap item, not runtime behavior.
- **Illustrative:** invented numerical assumptions or a synthetic task, not an ACP benchmark.

## Primary code map

| Question                                | Source                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Ticket/run creation and prompt          | `packages/server/src/board/service.ts`, `packages/orchestrator/src/plan.ts`                                |
| Authorization / scheduling              | `packages/orchestrator/src/{commands,policy,program,draft,loop}.ts`                                        |
| Start helper / message                  | `packages/orchestrator/src/lead-tools.ts`                                                                  |
| Persistence before effects / SDK wiring | `packages/server/src/control/service.ts`                                                                   |
| Role tools and branch safety            | `packages/adapters/claude-code/src/managed/{adapter,permissions,branch-guard}.ts`                          |
| Context assembly                        | `packages/server/src/board/harness.ts`, `packages/server/src/harness/context.ts`                           |
| Outcomes and retry bounds               | `packages/orchestrator/src/{report-tool,change-commands,step-attempts}.ts`                                 |
| Checks, setup and serialization         | `packages/server/src/board/checks.ts`, `packages/server/src/harness/runner.ts`                             |
| Conflict policy and execution           | `packages/core/src/workspace/conflict-resolution.ts`, `packages/server/src/control/conflict-resolution.ts` |
| Usage and caps                          | `docs/usage-accounting.md`, ADR-0014, `packages/orchestrator/src/budget.ts`                                |
| Future provider scope                   | `docs/roadmap.md`, `packages/core/src/adapters/managed.ts`                                                 |

## External primary references

- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):
  reusable prefixes and observed read/write usage; not a guarantee of ACP cache hits.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching):
  model-specific prefix reuse; not proof of a future Codex transport option.
- [Context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents):
  focused context and retrieval. The ACP layer design is our proposal.
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
- [GitHub Pages creation and visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

These references were consulted on 2026-10-27. No model prices, discounts, context capacities or
provider availability are pinned here; those change and need provider-specific verification.

## Updating this guide

Reinspect the baseline before changing claims. Update Markdown and its visual counterpart in the
same change, review the issue status table, and rerun local/public-subpath navigation, keyboard,
mobile, print and offline tests. Keep actual verification in COMPLETION.md. Do not turn a proposal
into an implemented statement just because a design document exists.

## Public content scope

This package does not contain private screenshots, live project paths or inventory, session IDs,
credentials, transcripts, prompts from real runs or raw tool output. Historical arithmetic is
anonymized; synthetic scenarios are labeled. The site uses local CSS/JS/SVG and no analytics,
external fonts, runtime API or embedding service. Outbound citations load only when clicked.

## Governance follow-up

ADR-0030 and the CR status table still label the now-merged implementation proposed/review. The
newer AGENTS file also retains an owner-click-only safety clause alongside its delegated-delivery
exception. Maintainers should reconcile the authority/status wording separately. This documentation
PR changes neither shared authority files nor runtime permission behavior.
