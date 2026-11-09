# ADR-0034: A local code map per project, for agents and the owner

- **Status:** accepted (project owner, in chat, 2026-11-08: "start implementing this")
- **Date:** 2026-11-08
- **Deciders:** project owner; implementing agent (draft)
- **Amends:** ADR-0009 (adds a source-derived metadata store that holds no conversation content)
- **Relates to:** ADR-0012/0031 (agent tools), ADR-0017 (project context), ADR-0021 (plans and
  helpers), [docs/code-map/](../code-map/README.md), and the owner's token-efficiency analysis of
  2026-10-27 (issues T01 repeated discovery, T02 role duplication, T16 stale knowledge, T17 bad
  retrieval, T23 maintenance cost, T24 untrusted cached text)

## Context

Every ticket starts fresh agent sessions (lead, planner, helpers, reviewers, tester). Each one
rediscovers the repository with read and search tools, and helpers repeat what the lead already
found. ACP has no cross-ticket repository knowledge: only up to 10 owner-chosen context files
(32 KiB) and the same ticket's earlier summary. Tools such as Graphify show that a deterministic
symbol and import graph, cached by content hash and queried by the agent, cuts repeated discovery
on non-trivial repositories, but Graphify itself is far broader than ACP needs (LLM passes for
documents and media, clustering, exporters, viewers, an installer).

## Decision

1. **What is stored.** Per project, a code map derived from the repository at a commit:
   - per file (keyed by the git blob SHA, so identical content is parsed once across commits and
     worktrees): path, language, size, line count, exported symbols (name, kind, line), imports
     (specifier, resolved repository path or null) and whether it is a test;
   - per indexed commit: the manifest (path → blob SHA), when it was built, the indexer version, and
     counts (files, symbols, unresolved imports, skipped files with reasons).

   No source text, no comments, no string literals, no conversation content. Symbol names and paths
   are source-derived metadata; they are data, never instructions, and never grant permissions.

2. **How it is built.** Deterministic and local, with no LLM and no network:
   - the file list and blob SHAs come from `git ls-tree -r <commit>` (an argument array, ADR-0013),
     so `.gitignore` is respected and unchanged files are never re-parsed;
   - TypeScript and JavaScript are parsed with the TypeScript compiler API (`typescript`, already
     pinned in the workspace, added as a server dependency); other languages get file-level entries
     (path, language, size) until a later parser is added;
   - caps: files larger than 512 KiB, binary files and generated or vendored paths are skipped with a
     reason; at most 20 000 files per manifest.
3. **Freshness.** Built lazily: when a ticket run starts (on its base commit) and on the owner's
   refresh. Every answer names the commit it describes. A map is never presented as describing a
   commit it was not built from.
4. **Agents.**
   - A short repository map (packages, entry points, key modules, test locations; at most 4 KiB) is
     added to every agent's context, before task-specific text so providers can reuse the prefix.
   - Every role gets a read-only `code_map` control tool (find a symbol, a file's exports, imports,
     importers and tests, a bounded neighbourhood, a path or name search). It returns paths, names
     and line numbers, never file content. It works for Claude (in-process MCP) and Codex (dynamic
     tools).
   - A plan step may name likely files; the helper's brief then carries those files, their bounded
     neighbourhood and the lead's notes. This is a hint, never a scope limit.
5. **Owner.** A "Code map" page per project shows the indexed files as an explorable graph (files
   grouped by folder or package, import edges), with search, a file detail panel and the map's
   commit and age.
6. **Isolation.** Maps are per project and local; deleting a project deletes its map. No upload.

## Alternatives considered

- **Use Graphify as is.** Python, about 25 native grammars, LLM passes and an installer that edits
  agent config; far beyond the need and against ACP's local-only, no-config-edits rules.
- **Embeddings or a vector store.** Needs a model call or a local model; the token-efficiency
  analysis advises measuring lexical and symbol lookup first.
- **A scout agent per ticket.** Pays a full discovery each time; the cost this ADR removes.
- **One long-lived project agent.** Task contamination, stale permissions, growing history.

## Consequences

- New migration (code map tables), a new server dependency (`typescript`), a new control tool and
  a new web page.
- Measurement comes with it: content-free counts of read and search tool calls per agent, so the
  effect can be shown with real runs instead of claimed.
- To revisit: more languages (tree-sitter WASM), call edges, and hints from earlier tickets that
  touched the same files.
