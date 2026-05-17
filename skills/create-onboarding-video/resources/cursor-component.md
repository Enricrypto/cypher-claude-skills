# Cursor component reference

Bundled resource for the `create-onboarding-video` skill. **Load only when authoring or modifying a beat that includes a tap.** Pure illustrative beats (glow rings, animated state changes, results landing) do not need a cursor and do not need this file.

The skill ships three primitives, all in one file at `src/components/Cursor.tsx`:

| Primitive | Use it for |
|-----------|------------|
| `Pointer` | A persistent translucent dot that **moves** to lead the eye. Required for any tap. |
| `TapDot`  | A short ripple at the moment of tap. Always overlay this **on top of** a `Pointer` at the same coords. |
| `GlowRing` | A ping that pulses around a chip / button to *highlight* a feature, with no tap implied. Use only on illustrative beats. |

## The rule this resource exists to enforce

> **Cursor leads every tap.** A tap ripple alone is not enough — the viewer must see the cursor travel to the target before the ripple fires. No teleporting, no jump-cuts.

If a beat has any tap, click, or selection, render a `Pointer` whose coordinates animate from an off-target start position to the target, and lay a `TapDot` over it at the moment of contact. Always pair the two — they share `x`/`y`.

## Component source

```tsx
// src/components/Cursor.tsx — copy this verbatim into any new project.
import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

/**
 * iOS-style touch indicator — a translucent circle that appears at a tap
 * point and pulses outward.
 */
export const TapDot: React.FC<{
  tapAt: number;
  x: number;
  y: number;
  size?: number;
  color?: string;
}> = ({ tapAt, x, y, size = 110, color = "rgba(59, 130, 246, 0.55)" }) => {
  const frame = useCurrentFrame();
  const fade = interpolate(
    frame,
    [tapAt - 4, tapAt, tapAt + 18, tapAt + 28],
    [0, 1, 0.35, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const ringScale = interpolate(frame, [tapAt, tapAt + 24], [0.4, 1.8], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringFade = interpolate(frame, [tapAt, tapAt + 24], [0.7, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dotScale = interpolate(
    frame,
    [tapAt - 4, tapAt, tapAt + 8],
    [1, 0.78, 1],
    {
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  return (
    <div
      style={{
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: `3px solid ${color}`,
          opacity: ringFade,
          transform: `scale(${ringScale})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
          opacity: fade,
          transform: `scale(${dotScale})`,
        }}
      />
    </div>
  );
};

/**
 * Persistent translucent dot. Use to *lead* the eye to the tap target.
 * Required on any beat that has a tap or selection.
 */
export const Pointer: React.FC<{
  x: number;
  y: number;
  size?: number;
  opacity?: number;
}> = ({ x, y, size = 64, opacity = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: x - size / 2,
      top: y - size / 2,
      width: size,
      height: size,
      borderRadius: "50%",
      background: "rgba(15, 23, 42, 0.42)",
      border: "4px solid rgba(255, 255, 255, 0.85)",
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.28)",
      opacity,
      pointerEvents: "none",
    }}
  />
);

/**
 * Look-here pulse for *illustrative* beats. No tap implied.
 */
export const GlowRing: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  startAt: number;
  duration?: number;
  color?: string;
  radius?: number;
}> = ({
  x,
  y,
  width,
  height,
  startAt,
  duration = 36,
  color = "rgba(59, 130, 246, 0.85)",
  radius = 999,
}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [startAt, startAt + duration / 2, startAt + duration],
    [0, 1, 0],
    {
      easing: Easing.bezier(0.45, 0, 0.55, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const scale = 1 + progress * 0.08;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        borderRadius: radius,
        boxShadow: `0 0 0 4px ${color}, 0 0 30px 6px ${color}`,
        opacity: progress,
        transform: `scale(${scale})`,
        transformOrigin: "center",
        pointerEvents: "none",
      }}
    />
  );
};
```

## Canonical pattern A — single tap (fade in at center, glide to target)

Every single-tap beat follows this two-phase shape. The pointer **fades in at the visual center** of the focal area, then glides in **one straight line** (any direction — vertical, horizontal, diagonal) to the interaction point. Tap fires when it arrives. Pointer fades out in place.

```tsx
// src/scenes/BeatX.tsx — single-tap interactive beat
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Pointer, TapDot } from "../components/Cursor";
import { Slice } from "../components/Slice";
import { TopCaption } from "../components/Caption";
import { CAPTION_BAND, COLORS, FONT, p } from "../theme";

export const BeatX: React.FC = () => {
  const frame = useCurrentFrame();

  // 1. Single source of truth for *when* the tap fires.
  const tapAt = p(48);

  // 2. Center-of-focal-area start point + target end point, both in the
  //    same coord space (slice-local or container-local).
  const sliceWidth = 820;
  const sliceHeight = 808;
  const startX = sliceWidth / 2;
  const startY = sliceHeight / 2;
  const targetX = 220;
  const targetY = 580;

  // 3. Opacity: fade in BEFORE the move begins so the pointer visibly
  //    materialises at center. Hold full opacity through the tap, then
  //    fade out in place.
  const fadeIn = interpolate(frame, [p(6), p(16)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [tapAt + p(10), tapAt + p(20)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const pointerOpacity = fadeIn * (1 - fadeOut);

  // 4. ONE straight move from start → target. Single normalised progress
  //    drives both x and y so the path is a true straight line. Move
  //    starts AFTER fade-in completes so the materialise is visible.
  const moveProgress = interpolate(frame, [p(16), tapAt], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pointerX = interpolate(moveProgress, [0, 1], [startX, targetX]);
  const pointerY = interpolate(moveProgress, [0, 1], [startY, targetY]);

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        fontFamily: FONT,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: CAPTION_BAND,
      }}
    >
      <div style={{ position: "relative" }}>
        <Slice src="screen.png" sx={42} sy={150} sw={1095} sh={sliceHeight} width={sliceWidth} />
        {/* Always render Pointer + TapDot together at the same coord space. */}
        <Pointer x={pointerX} y={pointerY} opacity={pointerOpacity} />
        <TapDot tapAt={tapAt} x={targetX} y={targetY} size={120} />
      </div>
      <TopCaption>Pick a date</TopCaption>
    </AbsoluteFill>
  );
};
```

## Canonical pattern B — multiple taps on the same UI (single continuous cursor)

When a single beat has two or more taps on the **same UI** (e.g. selecting a segment then tapping the button on the same form), keep **one persistent pointer** that fades in once at center, glides to the first target, then glides **directly** from each target to the next without resetting. Only fade out after the last tap.

```tsx
const tapAAt = p(40);
const tapBAt = p(90);
const A = { x: 600, y: 60 };
const B = { x: 600, y: 250 };

// ONE pointer. ONE fade-in (at center). ONE fade-out (after last tap).
const pointerOpacity = interpolate(
  frame,
  [p(8), p(20), tapBAt + p(15), tapBAt + p(28)],
  [0, 1, 1, 0],
  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
);

// x and y interpolate through *one keyframe per stage*. Each consecutive
// pair of keyframes describes a single straight segment (any direction).
// The "hold" keyframes (target equals previous) keep the pointer parked
// during the tap ripple before the next move starts.
const pathFrames = [
  p(20),            // start of glide-from-center
  tapAAt,           // arrive at A
  tapAAt + p(20),   // hold at A while ripple settles
  tapBAt,           // arrive at B (single straight glide from A)
];
const pointerX = interpolate(
  frame,
  pathFrames,
  [centerX, A.x, A.x, B.x],
  { easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp" },
);
const pointerY = interpolate(
  frame,
  pathFrames,
  [centerY, A.y, A.y, B.y],
  { easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp" },
);

<Pointer x={pointerX} y={pointerY} opacity={pointerOpacity} />
<TapDot tapAt={tapAAt} x={A.x} y={A.y} />
<TapDot tapAt={tapBAt} x={B.x} y={B.y} />
```

**Key invariants:**
- **One** pointer instance, **one** fade-in at center, **one** fade-out after the last tap. Never fade the pointer out and back in between taps on the same UI.
- Each segment between consecutive keyframes is a single straight line (interpolating both `x` and `y` linearly between the same pair of frames). Direction is free — vertical, horizontal, diagonal all fine.
- Use `[..., A, A, ...]` "hold" pairs to park the pointer during a tap ripple before the next move starts. Without the hold, the pointer would drift mid-tap.
- Diagonals are explicitly **allowed** — what's forbidden is multi-segment paths within a single move (one move, one straight line) or fading the pointer out + back in between same-UI taps.

## When to reset the cursor (different UI / new screen)

If the next interaction lands on a *different* UI (a new screen, a different form, the next beat) — only then does the pointer reset. Fade out the current pointer, render a new one with its own fresh fade-in at center, glide to the new target. The reset is the visual cue that the viewer is somewhere new.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Rendering only a `TapDot` so the tap appears out of nowhere | Add a `Pointer` whose coords interpolate to the target. The cursor *must* be visible before the tap. |
| Pointer disappears at the moment of tap | Keep the Pointer visible for ~10 frames *after* `tapAt` so the eye sees the contact, then fade it out. |
| Pointer placed in a different coord space than the TapDot | Both must live inside the same `position: relative` parent and share `x`/`y`. |
| Adding a Pointer to a purely illustrative beat | Use a `GlowRing` instead. Cursors imply user input. |
| Using a single keyframe (a straight line from start to target) | Use 2–3 keyframes so the path bends naturally — straight paths feel mechanical. |

## When NOT to use this

- Beats that highlight features without any tap (glow rings, animated state, result landing): use `GlowRing` or no indicator at all.
- Beats that show a passive transition between screens with no implied user action.
- The first or last beat of a video that establishes context or shows the final result.

In those cases, do **not** load this file or add a cursor — let motion alone carry the eye.
