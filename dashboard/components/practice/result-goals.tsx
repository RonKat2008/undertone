import { Check, CircleDashed, Crosshair, Target } from 'lucide-react';
import { ICON, Panel, Section } from '@/components/ui';
import { checkWords, evidenceWords, fromAnswerWords, type PracticeGoal, type PracticeGoalCheck } from '@/lib/practice/model';

/** One goal: its title, the target, and where it came from (the answer and what was heard). */
export function GoalItem({ goal }: { goal: PracticeGoal }) {
  const from = fromAnswerWords(goal.from_answer);
  const evidence = evidenceWords(goal.evidence);
  return (
    <li className="pr-goal">
      <span className="pr-goal-mark" aria-hidden><Target {...ICON} size={16} /></span>
      <div className="min-w-0">
        <p className="text-body font-medium text-fg">{goal.title}</p>
        <p className="text-body text-fg/85 text-pretty">{goal.target}</p>
        {from || evidence ? (
          <p className="pr-goal-from">
            {from ? <span>{from}</span> : null}
            {evidence ? <span className="pr-goal-quote">{evidence}</span> : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** "Goals for next time": the checklist the next practice will check. */
export function NextGoals({ goals }: { goals: PracticeGoal[] }) {
  return (
    <Section title="Goals for next time" icon={<Crosshair {...ICON} size={16} aria-hidden className="text-coach" />}>
      <Panel tone="coach">
        {goals.length === 0 ? (
          <p className="text-body text-muted">Nothing stood out to work on. Keep doing what you did.</p>
        ) : (
          <ul className="pr-goals">{goals.map((g) => <GoalItem key={`${g.measure}-${g.title}`} goal={g} />)}</ul>
        )}
      </Panel>
    </Section>
  );
}

const CHECK_ICON = { met: Check, not_yet: CircleDashed, unknown: CircleDashed } as const;

/** Last time's goals, checked against this practice. */
export function GoalChecks({ checks }: { checks: PracticeGoalCheck[] }) {
  return (
    <Section title="Last time’s goals">
      <Panel>
        <ul className="pr-checks">
          {checks.map((c) => {
            const { tone, word } = checkWords(c.met);
            const Icon = CHECK_ICON[tone];
            return (
              <li key={`${c.goal.measure}-${c.goal.title}`} className="pr-check" data-tone={tone}>
                <span className="pr-check-mark" aria-hidden><Icon {...ICON} size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-fg">{c.goal.title}</p>
                  <p className="text-body text-muted text-pretty">{c.detail || c.goal.target}</p>
                </div>
                <span className="pr-check-word">{word}</span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </Section>
  );
}
