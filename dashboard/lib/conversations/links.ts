/** Routes into the conversations library. Query-param style, like /debrief?session=<id>. */
export const LIBRARY_HREF = '/conversations';

export function conversationHref(sessionId: string): string {
  return `/conversations/view?session=${encodeURIComponent(sessionId)}`;
}
