/*
 * Links to the full-width review pages (v0.3.0 D-A): every file of a ticket's branch, and one
 * helper's change, each like GitHub's "Files changed". D-A owns the routes and `href`; these local
 * helpers build the same addresses until the coordinator switches the ticket page to D-A's helpers
 * at merge (docs/v0.3.0/wp/D-B.md).
 */

const enc = encodeURIComponent;

/** `#/p/:projectId/tickets/:ticketId/files`: every file of the ticket branch. */
export function ticketFilesHref(ticket: { id: string; projectId: string }): string {
  return `#/p/${enc(ticket.projectId)}/tickets/${enc(ticket.id)}/files`;
}

/** `#/p/:projectId/tickets/:ticketId/changes/:agentRunId`: one helper's change. */
export function ticketChangeHref(
  ticket: { id: string; projectId: string },
  agentRunId: string,
): string {
  return `#/p/${enc(ticket.projectId)}/tickets/${enc(ticket.id)}/changes/${enc(agentRunId)}`;
}
