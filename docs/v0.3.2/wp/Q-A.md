# Q-A — restart rework engine

Status: review. Branch: `fix/orchestration/rework-after-restart`.

- Agent liveness is defined independently of outgoing transitions, so recovered agents remain
  stopped until an owner action. Only a proven sealed change with a complete ledger can restart.
- The owner resumes the helper and, if available, the lead. Tests cover repeated restarts, session
  loss, review waits and replayed budget usage; the server integration test reaches final merge.
- Recovery evidence and the ledger use an additive migration. Runs without a complete ledger or a
  verified current seal remain ineligible. A consented real-provider run has not been performed.
