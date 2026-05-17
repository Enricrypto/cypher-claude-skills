---
name: create-onboarding-video
description: Produce short, punchy iOS app onboarding videos in Remotion that showcase a feature in action by animating isolated pieces of the UI (cropped components, not full screens) with nice UI-like transitions. Use when the user asks to create, build, or generate an onboarding video, app preview, feature demo clip, App Store preview, or any short video that demonstrates a mobile app feature using supplied screenshots.
---

# Create Onboarding Video

Produce a **short, punchy iOS onboarding video** in Remotion that showcases one feature working. Output is meant to feel like an App Store preview zoomed into the moment that proves the feature works — not a tutorial, not a screen recording, not a marketing reel.

## What you make

- **Length:** short. 3–8 seconds per onboarding screen, stitched together. Whole video rarely exceeds ~30s.
- **Style:** UI-first, **never the whole screen**. Each beat shows a **piece of the feature in action** — a single button being tapped, a toggle flipping, a row reordering, a sheet sliding up, a chart filling in — animated with **nice UI-like transitions** (springs, slides, scales, crossfades, masked reveals, shared-element swaps).
- **What "pieces" means:** crop, mask, or extract just the relevant component from the supplied still — the card, the input field, the tab bar, the empty state turning into a filled state. The rest of the UI is omitted, blurred, or implied by a tinted background. We are showcasing **what the feature *does*,** not what the whole app looks like.
- **Tone:** to the point. Each beat communicates one thing the feature does.
- **Output:** a Remotion project that renders to MP4 (and optionally a portrait variant for App Store previews).

## Workflow

Follow this loop. **Do not skip the intake — guessing at flows produces generic videos.**

### 1. Intake — ask for stills + intent

For each onboarding screen the user wants to feature, collect:

1. **Still shots (screenshots)** of the screen — ask for **2–4 stills per screen** so you can show interaction states:
   - resting state
   - mid-interaction (button pressed, field focused, sheet halfway up, etc.)
   - result state (data loaded, success, next screen)
   - any variant worth showing (empty vs. filled, light vs. dark, etc.)
2. **What the feature is** — one or two sentences on what this screen does for the user and what makes it feel good. This drives which detail to zoom into.
3. **Order** — the sequence of screens in the onboarding flow.
4. **Optional:** brand color / accent, font if non-standard, target aspect ratio (default 1080×1920 portrait for iOS), end-card text/CTA.

Use `AskUserQuestion` when the user is vague. Don't start rendering until you have stills + intent for every screen.

### 2. Plan the shots

For each screen, identify the **single piece of the feature that proves the feature works** — the tapped button, the filling progress ring, the row that gets swiped, the field that auto-completes — and how it transitions to the next beat. **Never animate the whole screen.** Sketch the timeline (focal element → motion → result → next focal element) before writing components. Prefer:

- isolating/cropping/masking the relevant component out of the still and placing it on a tinted background
- showing the *interaction itself* (tap ripple, drag, focus, state change) rather than just the static layout
- shared-element transitions between beats (the button on beat 1 becomes the header on beat 2)
- subtle parallax / depth on layered elements
- spring-based motion over linear easing

### 3. Build with Remotion

**Always invoke the `remotion-best-practices` skill before writing Remotion code.** When you do, include this guidance in your prompt to it:

> Build a short iOS-app onboarding video. **Never render the whole screen** — each beat must show a *piece of the feature in action*: an isolated/cropped/masked UI component (button, card, row, sheet, field, chart, etc.) animating through the interaction that demonstrates what the feature does. Place it on a clean tinted background; the rest of the app chrome is omitted or implied. Use **nice UI-like transitions** — springs, masked reveals, shared-element morphs, crossfades, parallax — to move between beats. Prefer `spring()` over linear interpolation, use `<Sequence>` to chain beats, and keep each beat short (90–240 frames at 30fps). Stills go in `public/` and load via `staticFile()`; crop them with CSS `clip-path` / `overflow: hidden` / absolute positioning to extract the focal element.

Project conventions:
- Source stills in `public/<screen-name>/<state>.png`.
- One `<Composition>` per onboarding flow; one `<Sequence>` per screen-beat inside it.
- Components in `src/scenes/`, shared transitions in `src/transitions/`.
- Default 30fps, 1080×1920 portrait; expose width/height as props so the same scenes render landscape if asked.

### 4. Iterate

Render a preview, show it to the user, and ask which beats need to be slower, faster, or restaged. Treat the first render as a draft.

## Operating rules

- **Stills are required.** If the user hasn't provided screenshots, stop and ask. Do not invent UI from descriptions.
- **Pieces of the UI, not the whole UI.** If you catch yourself rendering a full-screen mockup, stop and crop down to the component that carries the beat. The viewer should see the *feature in action*, not a tour of the app.
- **One feature per video.** If the user describes 5 unrelated features, propose splitting them into 5 videos.
- **Show, don't narrate.** No voiceover, no big text overlays explaining the feature — let the UI motion carry it. A short caption per beat is fine.
- **Captions are visible for the entire beat.** Each beat's supportive caption fades in within the first ~10–14 frames of the beat and remains on screen for the whole sequence. Do **not** delay caption entry to mid-beat or fade it out before the beat ends — the viewer should be able to read the line the entire time the focal UI is on screen. Let the scene-level crossfade between beats carry the caption swap.
- **Captions rise in from below.** They start ~60px under their rest position with opacity 0 and slide up + fade in together (strong UI ease-out, e.g. `Easing.bezier(0.16, 1, 0.3, 1)`). Never have a caption appear in place or drop in from above — the upward motion is part of the visual identity.
- **Captions live at the top, always at the same spot.** Anchor every caption to a fixed top-of-frame position (e.g. ~100px from the top, horizontally centered) and reuse that position across every beat. **Never** put a caption below the focal UI, never let it drift from beat to beat. Reserve a consistent top "caption band" (~200–240px) and lay the focal slice out below it. Build a single `TopCaption` wrapper component and use it everywhere — don't position captions inline per scene.
- **Captions are big.** Default font size for a 1080-wide canvas is around 54px, weight 700, with a `maxWidth` so long lines wrap instead of running off-frame. They are headline-size callouts, not subtitle-size labels.
- **Same caption across connected beats stays put.** When two consecutive beats are conceptually parts of the same moment and share the *exact same caption text* (e.g. one beat shows tapping the day, the next shows the form opening — same headline applies to both), the caption must **not** re-animate at the cut. It rises and fades in once on the first beat, then on every continuation beat is rendered with `staticEntry` (or equivalent: instant full opacity, rest position, no slide). The two captions composite identically during the scene crossfade so the viewer perceives a single caption that persists across the cut, not a flicker. **Only** use this when the text is *exactly* the same — if the caption changes at all between beats, let the new one rise-and-fade-in normally so the change reads.
- **Cursor leads every tap.** If a beat shows a *tap, click, or selection*, a visible cursor (`Pointer`) **must** appear, **move along a path**, and arrive on the target before the tap ripple fires. No teleporting, no jump-cut taps. The cursor's motion is what tells the viewer where the action is about to happen — the tap ripple alone is not enough. Beats that are purely *illustrative* (highlighting a feature with glow rings, animating a static state, showing a result land) do **not** require a cursor; let glow / motion carry the eye instead. Decide per beat: **interactive → cursor leads; illustrative → no cursor.** For the cursor component itself and a copy-pasteable usage pattern, load `resources/cursor-component.md` only when you are about to author or modify a beat that has a tap.
- **Cursor fades in at center, then moves in one straight line to the target.** The first interaction in a beat is always:
  1. **Fade in at the visual center** of the focal area (slice center / container center — whatever the viewer's eye is parked on for the beat). The pointer materialises in place; it does not enter from off-frame.
  2. **One single straight move** from that center to the interaction point. Direction is free — vertical, horizontal, **diagonal** are all fine, as long as it's *one straight segment*. Both `x` and `y` may change together (this is the only place a diagonal is allowed). Use a single decelerating ease (e.g. `Easing.bezier(0.16, 1, 0.3, 1)`) so the cursor feels guided, not flung.
- **Multiple taps on the same UI: the pointer stays visible and glides from one to the next.** When a single beat has two or more interactions on the **same UI** (e.g. tapping a segment then tapping the Create button on the same form), **do not reset the pointer between taps**. The pointer fades in once at center, glides straight to the first target, taps, then **glides directly from that target to the next target** in one continuous straight segment, taps, and so on. Only after the *last* interaction does it fade out. Never fade out + fade in at center between taps on the same UI — that breaks the sense of a single user driving the action. Each segment between consecutive interactions is itself a **single straight line** (any direction allowed, same diagonal-OK rule as the entry).
- **Different UI / new screen: reset.** If the next interaction lands on a *different* UI (a new screen, a different form, a different beat altogether) the pointer does fade out and the next interaction starts with a fresh fade-in at center. The reset is what tells the viewer "we're somewhere new now."
- **Forbidden:** entering from off-frame edges, multi-segment paths within a single move, curves, zig-zags, intermediate keyframes that bend the trajectory, fading the pointer out + back in between taps on the **same** UI. The motion should feel like the user's finger **appearing where the eye already is** and gliding straight to each action in turn — not like a hand entering from off-screen, and not like the cursor blinking out between every tap on the same form.
- **Match the app's design language.** Use the colors, corner radii, and type from the supplied stills; don't restyle them.
- **Delegate to `remotion-best-practices`.** It is the source of truth for how to write Remotion code — invoke it any time you're about to author or modify a composition, scene, or transition.

## When in doubt

Ask. A 10-second clarifying question saves a 2-minute render that misses the point.
