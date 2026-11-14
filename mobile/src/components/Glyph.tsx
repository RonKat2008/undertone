import React, { useEffect, useId } from 'react';
import { View } from 'react-native';
import Svg, { Rect, Path, Defs, ClipPath } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withSequence,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { HapticPattern } from '../bus/contracts';

export interface GlyphProps {
  pattern: HapticPattern;
  playing?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const SIZES = {
  sm: 24,
  md: 48,
  lg: 96,
  xl: 128,
};

const DEFAULT_COLORS: Record<HapticPattern, string> = {
  interrupt: '#E03C31',
  wrap_up: '#D97706',
  filler: '#B48A14',
  slow_down: '#2563EB',
  still: '#7C3AED',
  success: '#16A34A',
  tap: '#FAFAFA',
  approve: '#FAFAFA',
  status_good: '#FAFAFA',
  status_talking: '#FAFAFA',
  status_ask: '#FAFAFA',
};

type BarDef = { x: number; w: number; h: number; y: number; rx?: number; delay: number; duration: number };

const PATTERN_BARS: Record<HapticPattern, BarDef[]> = {
  tap: [{ x: 40, w: 20, h: 30, y: 70, delay: 0, duration: 80 }],
  interrupt: [
    { x: 35, w: 10, h: 80, y: 20, delay: 0, duration: 50 },
    { x: 55, w: 10, h: 80, y: 20, delay: 100, duration: 50 },
  ],
  filler: [{ x: 40, w: 20, h: 50, y: 50, delay: 0, duration: 100 }],
  wrap_up: [
    { x: 20, w: 15, h: 30, y: 70, delay: 0, duration: 80 },
    { x: 42.5, w: 15, h: 55, y: 45, delay: 150, duration: 80 },
    { x: 65, w: 15, h: 80, y: 20, delay: 300, duration: 80 },
  ],
  still: [
    { x: 10, w: 30, h: 20, y: 80, rx: 10, delay: 0, duration: 300 },
    { x: 60, w: 30, h: 20, y: 80, rx: 10, delay: 400, duration: 300 },
  ],
  success: [
    { x: 20, w: 25, h: 30, y: 70, delay: 0, duration: 80 },
    { x: 55, w: 25, h: 80, y: 20, delay: 120, duration: 80 },
  ],
  approve: [
    { x: 35, w: 10, h: 15, y: 85, delay: 0, duration: 50 },
    { x: 55, w: 10, h: 15, y: 85, delay: 80, duration: 50 },
  ],
  status_good: [{ x: 10, w: 80, h: 40, y: 60, delay: 0, duration: 400 }],
  status_talking: [
    { x: 10, w: 35, h: 40, y: 60, delay: 0, duration: 300 },
    { x: 55, w: 35, h: 40, y: 60, delay: 400, duration: 300 },
  ],
  status_ask: [
    { x: 10, w: 20, h: 40, y: 60, delay: 0, duration: 200 },
    { x: 40, w: 20, h: 40, y: 60, delay: 300, duration: 200 },
    { x: 70, w: 20, h: 40, y: 60, delay: 600, duration: 200 },
  ],
  slow_down: [], // Special case handled separately
};

function PulseBar({
  x,
  w,
  baseH,
  baseY,
  rx = 0,
  color,
  playing,
  reducedMotion,
  delay = 0,
  duration = 100,
}: {
  x: number;
  w: number;
  baseH: number;
  baseY: number;
  rx?: number;
  color: string;
  playing: boolean;
  reducedMotion: boolean;
  delay: number;
  duration: number;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      scale.value = 1;
      opacity.value = 1;
      return;
    }

    if (playing) {
      scale.value = 0.2;
      opacity.value = 0.5;

      const timer = setTimeout(() => {
        scale.value = withSequence(
          withTiming(1, { duration: duration * 0.5, easing: Easing.out(Easing.exp) }),
          withTiming(0.9, { duration: duration, easing: Easing.inOut(Easing.ease) })
        );
        opacity.value = withSequence(
          withTiming(1, { duration: duration * 0.5 }),
          withTiming(0.8, { duration: duration })
        );
      }, delay);

      return () => clearTimeout(timer);
    } else {
      scale.value = withTiming(1, { duration: 300 });
      opacity.value = withTiming(1, { duration: 300 });
    }
  }, [playing, reducedMotion, delay, duration]);

  const animatedProps = useAnimatedProps(() => {
    const currentH = baseH * scale.value;
    const bottom = baseY + baseH;
    const currentY = bottom - currentH;
    return {
      height: Math.max(0, currentH),
      y: currentY,
      opacity: opacity.value,
    };
  });

  return <AnimatedRect x={x} width={w} rx={rx} fill={color} animatedProps={animatedProps} />;
}

function SlowDownWedge({
  color,
  playing,
  reducedMotion,
}: {
  color: string;
  playing: boolean;
  reducedMotion: boolean;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const clipId = useId ? useId() : `wedgeClip-${Math.random()}`;
  const safeClipId = clipId.replace(/:/g, '-');

  useEffect(() => {
    if (reducedMotion) {
      scale.value = 1;
      opacity.value = 1;
      return;
    }

    if (playing) {
      scale.value = 0.2;
      opacity.value = 0.3;

      const timer = setTimeout(() => {
        scale.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) });
        opacity.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) });
      }, 0);

      return () => clearTimeout(timer);
    } else {
      scale.value = withTiming(1, { duration: 300 });
      opacity.value = withTiming(1, { duration: 300 });
    }
  }, [playing, reducedMotion]);

  const animatedProps = useAnimatedProps(() => {
    const baseH = 70;
    const baseY = 20;
    const currentH = baseH * scale.value;
    const bottom = baseY + baseH;
    const currentY = bottom - currentH;

    return {
      height: Math.max(0, currentH),
      y: currentY,
      opacity: opacity.value,
    };
  });

  return (
    <>
      <Defs>
        <ClipPath id={safeClipId}>
          <Path d="M 10 90 L 90 20 L 90 90 Z" />
        </ClipPath>
      </Defs>
      <AnimatedRect x="10" width="80" fill={color} clipPath={`url(#${safeClipId})`} animatedProps={animatedProps} />
    </>
  );
}

export function Glyph({ pattern, playing = false, size = 'md', color }: GlyphProps) {
  // Graceful fallback for useReducedMotion which might be undefined in some environments
  const reducedMotionHook = useReducedMotion ? useReducedMotion() : false;
  const reducedMotion = reducedMotionHook ?? false;
  
  const dimension = SIZES[size] || SIZES.md;
  const finalColor = color || DEFAULT_COLORS[pattern] || '#FAFAFA';

  return (
    <View style={{ width: dimension, height: dimension }}>
      <Svg viewBox="0 0 100 100" width="100%" height="100%">
        {pattern === 'slow_down' ? (
          <SlowDownWedge color={finalColor} playing={playing} reducedMotion={reducedMotion} />
        ) : (
          PATTERN_BARS[pattern]?.map((bar, i) => (
            <PulseBar
              key={i}
              x={bar.x}
              w={bar.w}
              baseH={bar.h}
              baseY={bar.y}
              rx={bar.rx}
              delay={bar.delay}
              duration={bar.duration}
              color={finalColor}
              playing={playing}
              reducedMotion={reducedMotion}
            />
          ))
        )}
      </Svg>
    </View>
  );
}
