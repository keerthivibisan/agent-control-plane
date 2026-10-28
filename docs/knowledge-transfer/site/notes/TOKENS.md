# 04 · Token efficiency: findings, numbers and opinion

## What we know

Fresh tickets create fresh runs/sessions; they do not automatically load the whole repository.
Agents discover code with tools. Separate roles can duplicate exploration, but we have not measured
how much discovery is repeated or attributed a token bill to it. One SDK query can make many model
rounds, so counting agent launches alone understates work.

Current mechanisms: up to 10 context files and 32 KiB assembled text; context read once per run and
passed to its agents; same-ticket summary continuity; helper rework resume when available;
structured outcomes and no-change attempt bounds; role/node model and effort settings. Byte limits
are not token limits, and run-local context reuse is not proof of a provider prompt cache hit.

## The issue: each new ticket can pay to learn the same code again

Imagine a large application with authentication, billing, notifications and shared libraries. Ticket A asks an agent to fix a login error. Before editing, it must locate the login route, follow the authentication service, understand shared validation and find the tests. Those reads are useful work: the agent needs evidence to make a correct change.

Ticket B later asks for another login change. It starts a separate run. ACP does not currently provide an automatic, project-wide memory of everything Ticket A discovered. The new lead and helpers may repeat searches and read the same route, service and tests. A reviewer may also inspect them independently. More tickets and more roles create more opportunities to repeat the same discovery.

This does not mean ACP automatically sends the entire repository to every agent. The model sees the context supplied to it and the results of tools it uses. An agent with an unclear brief may explore many folders or read large files; a focused agent may need only a few relevant modules. The risk is repeated broad exploration, not a guaranteed full-repository scan.

## How repeated reads become model input

A file exists on disk without consuming model tokens. When an agent reads it through a tool, the returned text becomes input for a later model request. Search results, instructions, the task, relevant conversation history and the requested answer also contribute. Long tool results can remain in context for subsequent requests, subject to the provider and transport’s context management.

If another session reads that file again, its returned text can enter another model request. That is a new opportunity for input consumption even though the source file did not change. A matching provider prompt cache may reduce repeated processing or price, but an unchanged file alone does not guarantee a cache hit. Fresh sessions do not imply either zero reuse or fully shared memory.

Consider four sessions: the lead, two helpers and a reviewer. In the illustrative comparison below, discovery uses 15,000 tokens per session, or 60,000 across four. If focused context reduces discovery to 5,000 per session, that becomes 20,000. With 30,000 other tokens unchanged, the example moves from 90,000 to 50,000. These are assumptions to explain the mechanism, not measured ACP savings or a dollar bill.

## Why a small ticket can still be expensive

Changing three lines may require understanding callers, permissions, data contracts and tests across several packages. Codebase size increases the search space; change size does not reliably predict discovery cost. Adding helpers can shorten elapsed time while increasing total reading, handoff, review and rework. Worktrees isolate edits; they do not automatically share what each agent learned.

The waste to reduce is avoidable rediscovery or irrelevant input. Re-reading current source to validate an assumption, checking a changed dependency and independently reviewing a security-sensitive edit can be necessary. Optimizing by forbidding those reads could save input while increasing incorrect changes and later repairs.

## Proposed fix: give each role a focused starting point, then verify it

These are proposed improvements, not an implemented project-memory service. Start with a small, source-backed project map: module responsibilities, entry points, important dependencies, invariants and where trusted tests are defined. Reuse that map across tickets only while its references remain valid. Do not generate a full repository summary separately for every helper.

For the login example, a ticket brief should name the relevant route, authentication service, shared validator and tests, explain the requested behavior, and identify what is still uncertain. The lead hands a helper the findings and source references it already has. The helper verifies those references in its own checkout and expands its search whenever the task requires it.

Keep shared essentials small and tailor additional context to the role. A documentation helper does not automatically need the billing implementation. A reviewer still receives the current diff, acceptance criteria and relevant checks, and retains enough independence to find mistakes rather than merely accepting the implementer’s account.

Key reusable source facts to the project and source snapshot; use file content hashes and invalidate affected entries after changes. Concurrent tickets can be based on different commits, so a correct map for Ticket A may already be stale for Ticket B. Source facts remain data, never permission grants. New persistent knowledge needs an explicit trust and retention design; do not store conversations or tool output as memory.

Measure net benefit per correctly accepted ticket: model input/output and cache categories, discovery overhead where reliably attributable, preparation and refresh work, retries, reviews, latency and regressions. Do not claim a saving if maintaining the map or fixing missed context costs more than the reading it avoided.

## What ACP already does, and what remains proposed

Implemented: bounded initial context of up to 10 files / 32 KiB, assembled once per run and passed to its agents; same-ticket summaries; helper-session continuation for rework when available; structured outcomes and attempt limits; role/node model and effort settings. These mechanisms help within the current design, but do not establish a cross-ticket memory or a provider cache hit.

Proposed: a reusable project map with freshness checks, task-specific retrieval and structured source handoffs, plus evaluation of their net benefit. The existing 32 KiB bound is a byte limit on initial context, not a total token cap or a limit on later file reads. The issue cards below pair each additional risk with its proposed control.

## 24 issue classes

| Issue                                                      | Issue / consequence                                                                                                                                         | Evidence / current status                                                                                                         | Proposed fix / control                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 Repeated repository discovery                          | Each ticket rediscovers layout, entry points and conventions. Cost grows with tickets and agents, not only repository size.                                 | Observed fresh-session mechanism; actual repeated reads unmeasured.                                                               | Small versioned project map; task-relevant retrieval.                                                                                               |
| T02 Planner/lead/helper duplication                        | Several roles independently investigate the same question because handoff contains little evidence.                                                         | Observed separate roles and helper briefs; overlap unmeasured.                                                                    | Structured handoff with findings, source references, assumptions and acceptance criteria. Preserve independent review where required.               |
| T03 Context copied to every role                           | Large generic context, profiles or skills are supplied even when irrelevant.                                                                                | Observed shared run context/profile assembly; actual bloat unmeasured.                                                            | Shared essentials plus role/task-specific references; hard size caps and explicit truncation.                                                       |
| T04 Broad search and oversized tool results                | Dumps of whole files, generated assets, lockfiles or long search output fill subsequent rounds.                                                             | Future risk; current byte cap does not bound tool exploration.                                                                    | Search filenames/symbols first, bounded excerpts, exclusions and expandable results.                                                                |
| T05 Growing conversation history                           | More messages and tool results increase input on later rounds; a long-lived agent becomes expensive to continue.                                            | General session risk; not profiled locally.                                                                                       | Bounded milestones, concise handoffs, provider-supported compaction when validated.                                                                 |
| T06 Prompt cache misses                                    | Changing earlier instructions, tool ordering, models or reference text prevents reusable prefixes. A run-local text cache is mistaken for provider caching. | Provider documentation; actual SDK cache hits require reported usage.                                                             | Stable useful prefixes; measure actual cache categories; do not add padding just to reach thresholds.                                               |
| T07 Over-delegation                                        | Many tiny helpers each pay startup, discovery, reporting and review overhead.                                                                               | Observed launch model; optimal task size unmeasured.                                                                              | Compare coordination overhead with independent work; combine related edits under one capable helper.                                                |
| T08 Overlapping parallel work                              | Helpers/tickets touch shared modules or depend on unmerged changes, causing conflicts and repeated fixes.                                                   | Observed isolated branch semantics; historical supplied screenshot case.                                                          | Dependency-aware scheduling, declared likely file scopes, shared-file hotspots, bounded conflict recovery. Scope estimates are advisory.            |
| T09 Blocked or impossible tasks retried                    | A helper is asked to perform an unsupported operation; replacement starts can repeat it.                                                                    | Historical screenshot case. Current conflict operations, structured outcomes and no-change attempt bounds mitigate this loop.     | Use the supported server operation; retain capability-aware briefs and progress measurements.                                                       |
| T10 Rework without new information                         | The next attempt repeats the same strategy without new evidence.                                                                                            | Current step/operation bounds cover no-change and failed outcomes; bounds do not prove each remaining attempt is useful.          | Use stable step identity and structured reasons; change strategy or stop within configured policy.                                                  |
| T11 Findings not consumed by the next actor                | Useful findings can still be omitted from a task or ignored by the recipient.                                                                               | The earlier no-change reporting gap is fixed by reportedOutcome and noChangeLine. Cross-ticket knowledge reuse is still proposed. | Keep structured handoffs, source pointers and outcome coverage; do not label the old gap open.                                                      |
| T12 Invalid tools and excessive polling                    | Repeated malformed calls, unknown targets or status checks consume model rounds without progress.                                                           | Future risk; status tools exist, frequency unmeasured.                                                                            | Clear schemas/capabilities, actionable refusals, event-driven completion where possible.                                                            |
| T13 Duplicate review                                       | Change reviewers, final reviewers and testers repeat identical analysis without a distinct acceptance goal.                                                 | Configurable review/stage mechanism; duplication unmeasured.                                                                      | Assign review purpose and scope; retain independent checks required by policy.                                                                      |
| T14 Repeated checks and log analysis                       | Same commit/check is rerun, or huge logs are repeatedly read by LLMs. Test execution itself is compute, not necessarily model-token usage.                  | Commit-specific gating exists; waste frequency unmeasured.                                                                        | Trusted evidence reuse only when commit, check definition, environment and policy match; bounded failure summaries.                                 |
| T15 Verification feedback too weak                         | Missing environment, unclear failure or flaky tests trigger speculative edits and repeated runs.                                                            | Future risk; setup failure already blocks SDK startup.                                                                            | Distinguish setup/product/flaky/unknown failures; provide reproducible command IDs and bounded diagnostics.                                         |
| T16 Stale knowledge and stale evidence                     | Cached architecture notes survive renames, branch changes or dependency updates, causing wrong edits and repair.                                            | Future risk for shared knowledge; context currently comes from owner checkout.                                                    | Commit/content-hash provenance, dependency invalidation, freshness checks against the agent's checkout.                                             |
| T17 Bad retrieval or over-compression                      | Relevant callers, invariants or tests are omitted; short prompts save input but cause more incorrect work.                                                  | Future risk.                                                                                                                      | Retrieval coverage checks, source pointers, uncertainty and on-demand expansion.                                                                    |
| T18 Wrong model or effort                                  | A costly model handles mechanical work, or a weaker configuration needs many failed attempts on hard work.                                                  | Role/profile/project model selection exists; no measured routing policy.                                                          | Evaluate outcome-adjusted work by task class; change configuration only under explicit policy.                                                      |
| T19 Verbose generated output                               | Long plans, repeated summaries and commentary add output and later input without helping execution.                                                         | Short work-note instruction already exists; other verbosity unmeasured.                                                           | Bounded structured plans/outcomes; retain required reasoning evidence without storing chain of thought.                                             |
| T20 Unbounded project-wide activity                        | Per-agent limits still allow many concurrent tickets, replacements and repeated runs to spend heavily in aggregate.                                         | Current ADR-0014 budget is per agent.                                                                                             | Proposed project/run aggregate admission and reservation policy with explicit unknown usage and overshoot. No silent change to existing accounting. |
| T21 Restart, reconnect and transport retries               | Launching another agent after an uncertain result duplicates work or abandons useful session state.                                                         | Restart recovery exists; provider/transport ambiguity remains a design concern.                                                   | Idempotent operations, reconciliation before retry and explicit resumability capability.                                                            |
| T22 Cross-provider accounting mismatch                     | Inclusive cached input, reasoning already included in output, or cumulative totals are summed again. A cheaper-looking provider may simply report less.     | Future Codex integration risk; existing ACP has strict accounting rules.                                                          | Versioned provider mappings, fixtures and provenance; no invented zeros or double counting.                                                         |
| T23 Knowledge maintenance costs more than it saves         | A scout rescans the whole monorepo or regenerates summaries for every small change.                                                                         | Future risk of the proposed optimization itself.                                                                                  | Deterministic metadata first, incremental invalidation, capped refreshes and measured net benefit.                                                  |
| T24 Cross-project leakage or untrusted cached instructions | Reused material includes another project's data or repository text is promoted to policy.                                                                   | Future risk; existing local-only and prompt-injection boundaries apply.                                                           | Project isolation, allowlisted paths, origin/provenance, treat retrieved text as data and keep permissions outside model control.                   |

## Our recommendation

Optimize the work needed for a correctly accepted ticket, including retries and verification.
Start with a small source-backed project map and focused role/task briefs, not a mandatory scout
agent or a permanent all-knowing project conversation. Preserve independent review when it serves a
real acceptance purpose. The current structured-outcome/retry fixes are a useful first step; measure
whether they reduce repeated attempts before adding more infrastructure.

Use four layers: (1) small owner-approved essentials; (2) incremental local module/symbol references;
(3) a bounded ticket/role context bundle; (4) current diff/check/review evidence. Retrieve more source
when needed. Start with maintained docs and lexical/symbol search; a vector store is not a
prerequisite, and an external embedding service is not authorized by this design.

Separate source facts from permission policy. Key reusable facts to project, source snapshot,
content hashes and producer/version. Check references against the helper's checkout, invalidate
dependents after renames/configuration/dependency changes and refresh selectively. Dirty checkout
content must not be described as commit-verified. Persisting new source-derived knowledge needs an
explicit trust/retention decision; never store conversation or tool I/O as memory under ADR-0009.

Provider caching is an additional mechanism: matching useful prefixes may reduce repeated input
processing, but do not guarantee a hit, free output or cross-provider reuse. Use observed usage;
API cache controls may not be exposed through an agent transport. Keep useful stable instructions
first, measure compaction tradeoffs and do not pad prompts just to qualify for a cache.
[Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## Numerical walkthrough

**Historical display evidence:** three Git-sync helper cards in a supplied earlier conflict case
show 5,836 + 6,847 + 8,297 = **20,980 budget tokens** while the conflict remains unresolved. Some
investigation was useful, so do not call all 20,980 wasted. This is anonymized screenshot arithmetic,
not a live replay, provider bill or measured current defect. The current baseline has mitigations
that the earlier case lacked: server-owned conflict recovery, outcome reporting and retry bounds.

**Everything in the following comparisons is hypothetical.** The amounts explain scaling, not
measured savings, forecasts or guarantees. We assume unchanged quality and other work; real tests
must challenge those assumptions.

| Four sessions: lead, two helpers, reviewer | Repeated discovery | Focused context |
| ------------------------------------------ | ------------------ | --------------- |
| Discovery per session                      | 15,000             | 5,000           |
| Discovery across four sessions             | 60,000             | 20,000          |
| Other implementation/coordination/review   | 30,000             | 30,000          |
| Total budget tokens                        | **90,000**         | **50,000**      |

Illustrative difference: **40,000**, about **44%**. This is not ACP performance evidence.
A useful brief would name the relevant authentication modules, callers, tests, invariants and
acceptance criteria while allowing more source discovery as needed.

| Across 20 comparable tickets        | Hypothetical budget tokens |
| ----------------------------------- | -------------------------- |
| 20 × 90,000 baseline                | 1,800,000                  |
| 20 × 50,000 focused work            | 1,000,000                  |
| One-time project-map preparation    | 8,000                      |
| Focused total including preparation | **1,008,000**              |
| Illustrative difference             | **792,000**                |

Later map maintenance, retrieval, failed attempts and regression repairs are omitted from this toy
model; real evaluation must include them. Rebuilding a whole repository map for every helper can
erase the benefit.

| Equal useful implementation work | Implementation | Discovery / coordination | Rework | Total      |
| -------------------------------- | -------------- | ------------------------ | ------ | ---------- |
| Two scoped helpers               | 30,000         | 10,000                   | 0      | **40,000** |
| Six overlapping helpers          | 30,000         | 30,000                   | 20,000 | **80,000** |

This is hypothetical. Six instances need not run simultaneously; configured capacity still applies.
More parallelism can reduce elapsed time while increasing total work. Worktree isolation does not
remove shared-module conflicts or hidden task dependencies.

## Budget is not billing

ADR-0014 budget tokens = uncached input + cache creation + output. Cache reads are shown separately
and excluded from the cap. The default is 500,000 **per agent**, configurable; three agents reaching
that allowance account for 1,500,000 before possible soft-cap overshoot. These are limit semantics,
not observed consumption. Ended-lead follow-up has its own fresh allowance per question.

Keep token categories/provenance, dedup global message identities, select max-output observations
and never sum cumulative snapshots. Missing usage is unavailable, never invented zero. Provider
estimated costs are not a verified combined bill. Pricing-table work remains outside this change.

## Measurement and rollout

1. Baseline accepted delivery, reopenings, regressions, owner interruptions, latency, reported
   usage categories/coverage, helper counts and retry/no-change outcomes. Done/discard is not
   sufficient proof of accepted delivery.
2. Measure total optimization overhead: context preparation, retrieval, refreshes, failed attempts,
   reviews and repairs. Test/check compute time is separate from LLM token consumption.
3. Use repeated controlled synthetic tasks: documentation, local bugs, cross-package APIs,
   refactors, conflicting targets and stale/missing context. Keep provider/model/settings and
   task difficulty comparable; report warm/cold cache conditions and distributions.
4. Compare focused briefs/current maps to a baseline before richer indexing or model routing.
   Change one factor at a time where practical, and keep acceptance quality as a guardrail.
5. Add provider conformance at Phase 6. Verify inclusive cached-input and reasoning semantics before
   mapping usage; never add a category twice. Unsupported evidence stays unavailable.

Current data does not establish exact discovery-versus-implementation token attribution. Proposed
metadata instrumentation must use explicit reliable phase links or report unknown. Do not infer
causal token cost from overlapping timestamps or add source/prompt/tool-content logging.
