/**
 * The old graph detail panel is gone (Insights opens people and topics in place). This link
 * helper stays because the conversation page imports it.
 */
export function debriefHref(sessionId: string): string {
  return `/debrief?session=${encodeURIComponent(sessionId)}`;
}
