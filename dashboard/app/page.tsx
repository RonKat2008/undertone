import { ArrowRight } from 'lucide-react';
import { Button, ListeningMark } from '@/components/ui';

/**
 * Placeholder hero so the shell can be reviewed. The Home page builder replaces it.
 * The graph that used to live here is unchanged at /insights.
 */
export default function Page() {
  return (
    <section aria-labelledby="hero-title" className="grid justify-items-start gap-6 pb-16 pt-14 sm:pt-24">
      <ListeningMark state="listening" size="lg" label="Undertone" />
      <h1 id="hero-title" className="max-w-[22ch] text-balance font-voice text-[32px] leading-[38px]">
        Hear how you sound, after every conversation.
      </h1>
      <p className="qi-lead max-w-[52ch] text-pretty text-muted">
        Your band listens while you talk. Afterwards your coach tells you what went well and one thing to try next time.
      </p>
      <Button href="/insights" variant="primary">
        See your insights
        <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
      </Button>
    </section>
  );
}
