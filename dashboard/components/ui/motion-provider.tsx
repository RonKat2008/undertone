'use client';

import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Mounted once by the shell. Loads motion's small DOM feature set and makes every `m.*`
 * element respect prefers-reduced-motion. Render `m.div`, not `motion.div` (strict mode
 * throws on `motion.*`, which would pull the full bundle).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
