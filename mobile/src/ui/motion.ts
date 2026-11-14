/**
 * Motion helpers. Everything animated uses Reanimated (UI thread) and honours Reduce Motion.
 * Curves are the strong ease-out / ease-in-out pair from the expo-animation guidance.
 */
import { Easing, useReducedMotion } from 'react-native-reanimated';

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

/** True when the system asks for reduced motion. Animations then cut instead of moving. */
export function useReduceMotion(): boolean {
  return useReducedMotion();
}
