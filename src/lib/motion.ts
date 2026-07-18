// Shared motion presets for React islands.
//
// Emil Kowalski's craft, centralized: springs for interactive/gesture motion
// (they keep velocity when interrupted), crisp sub-300ms durations for UI, and
// a subtle-overshoot spring reserved for playful moments (toggle thumbs, etc.).
// Islands import from here so admin motion stays consistent; reduced-motion is
// honored by re-exporting Motion's hook for callers to gate their own animation.
import type { Transition } from 'motion/react';
import { useReducedMotion } from 'motion/react';

export { useReducedMotion };

// Snappy: default for small controls (switch thumbs, chips). Fast settle, no bounce.
export const springSnappy: Transition = { type: 'spring', stiffness: 400, damping: 32 };

// Smooth: larger moves (panels, cards). A touch softer, still no visible overshoot.
export const springSmooth: Transition = { type: 'spring', stiffness: 220, damping: 30 };

// Duration presets in seconds (Motion uses seconds), mirroring the CSS --dur-* tokens.
export const DUR = { fast: 0.15, base: 0.2, slow: 0.3 } as const;
