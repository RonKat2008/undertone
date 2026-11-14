import { HapticPattern } from '../../bus/contracts';

export function getPatternFromRuleId(ruleId: string): HapticPattern {
  const clean = ruleId.replace(/^test_/, '').toLowerCase();
  const valid: HapticPattern[] = [
    'interrupt',
    'wrap_up',
    'filler',
    'slow_down',
    'still',
    'success',
    'tap',
    'approve',
    'status_good',
    'status_talking',
    'status_ask',
  ];
  if (valid.includes(clean as HapticPattern)) {
    return clean as HapticPattern;
  }
  if (clean.includes('interrupt')) return 'interrupt';
  if (clean.includes('wrap') || clean.includes('long')) return 'wrap_up';
  if (clean.includes('filler') || clean.includes('crutch')) return 'filler';
  if (clean.includes('slow') || clean.includes('fast') || clean.includes('pace')) return 'slow_down';
  if (clean.includes('still') || clean.includes('fidget') || clean.includes('hand')) return 'still';
  if (clean.includes('success') || clean.includes('good')) return 'success';
  return 'interrupt';
}

export function getNudgeMetadata(ruleId: string, pattern: HapticPattern): { reason: string; latency: string } {
  switch (pattern) {
    case 'interrupt':
      return { reason: 'Cut speaker off', latency: '315 ms' };
    case 'wrap_up':
      return { reason: 'Monologue > 45s', latency: '420 ms' };
    case 'filler':
      return { reason: 'Clustered crutch words', latency: '280 ms' };
    case 'slow_down':
      return { reason: 'Pace > 180 wpm', latency: '350 ms' };
    case 'still':
      return { reason: 'Excessive hand fidget', latency: '390 ms' };
    case 'success':
      return { reason: 'Structured framework', latency: '450 ms' };
    case 'tap':
      return { reason: 'Single band tap', latency: '120 ms' };
    case 'approve':
      return { reason: 'Awaiting permission', latency: '150 ms' };
    default:
      return { reason: 'Habit detected', latency: '310 ms' };
  }
}

export interface StatusReplyInfo {
  pattern: HapticPattern;
  title: string;
  meaning: string;
  pulses: string;
}

export function getStatusReplyInfo(verdict: string): StatusReplyInfo {
  if (verdict === 'talking_too_much') {
    return {
      pattern: 'status_talking',
      title: 'Talking too much',
      meaning: 'Yield the floor to your partner',
      pulses: '2 buzzes',
    };
  }
  if (verdict === 'ask_question') {
    return {
      pattern: 'status_ask',
      title: 'Ask a question',
      meaning: 'Monologue running long',
      pulses: '3 buzzes',
    };
  }
  return {
    pattern: 'status_good',
    title: 'Good pace and balance',
    meaning: 'In flow · Natural turn taking',
    pulses: '1 buzz',
  };
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
