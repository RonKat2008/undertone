'use client';

/**
 * /debrief and /debrief?session=<id> used to be their own page. They now open the one
 * conversation page: the named conversation, or the newest one, or the list when there is none.
 * Other query params (such as ?bus=) are carried along.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui';
import { newestConversation } from '@/lib/api/conversation';
import { conversationHref, LIBRARY_HREF } from '@/lib/conversations/links';

/** `href` with the current params (except `session`) appended. */
function withParams(href: string, params: URLSearchParams): string {
  const rest = new URLSearchParams(params);
  rest.delete('session');
  const extra = rest.toString();
  if (!extra) return href;
  return `${href}${href.includes('?') ? '&' : '?'}${extra}`;
}

export function DebriefRedirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const id = params.get('session');
    if (id && id.length <= 200) {
      router.replace(withParams(conversationHref(id), params));
      return;
    }
    let on = true;
    void newestConversation().then((r) => {
      if (!on) return;
      router.replace(withParams(r.kind === 'ok' ? conversationHref(r.id) : LIBRARY_HREF, params));
    });
    return () => { on = false; };
  }, [params, router]);

  return (
    <div className="qi-page" data-width="reading" role="status" aria-label="Opening the conversation">
      <Skeleton width={120} />
      <div className="mt-4"><Skeleton shape="block" height={36} width="70%" /></div>
      <div className="mt-8"><Skeleton shape="block" height={160} /></div>
    </div>
  );
}
