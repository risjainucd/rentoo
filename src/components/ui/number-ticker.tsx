"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "motion/react";

import { cn } from "@/lib/utils";

// Vendored from Magic UI (@magicui/number-ticker), adapted for Astro/SSR:
//  - renders the real `value` as initial content so no-JS / pre-hydration users
//    see the correct number (not the start value)
//  - inherits `currentColor` instead of forcing text-black, so it picks up the
//    surrounding editorial styling (e.g. paper on navy)
interface NumberTickerProps extends React.ComponentPropsWithoutRef<"span"> {
  value: number;
  startValue?: number;
  direction?: "up" | "down";
  delay?: number; // seconds
  decimalPlaces?: number;
  /** Text appended after the number, e.g. " min". Kept inside the span. */
  suffix?: string;
  /** Text prepended before the number, e.g. "₹". */
  prefix?: string;
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  suffix = "",
  prefix = "",
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(direction === "down" ? value : startValue);
  const springValue = useSpring(motionValue, {
    damping: 60,
    stiffness: 100,
  });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const format = (n: number) =>
    prefix +
    Intl.NumberFormat("en-IN", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(Number(n.toFixed(decimalPlaces))) +
    suffix;

  useEffect(() => {
    if (!isInView) return;
    const timer = setTimeout(() => {
      motionValue.set(direction === "down" ? startValue : value);
    }, delay * 1000);
    return () => clearTimeout(timer);
  }, [motionValue, isInView, delay, value, direction, startValue]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = format(latest);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [springValue, decimalPlaces, prefix, suffix],
  );

  return (
    <span
      ref={ref}
      className={cn("inline-block tabular-nums", className)}
      {...props}
    >
      {format(value)}
    </span>
  );
}
