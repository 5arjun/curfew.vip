# Project Instructions

## Custom Skills Audit Cycle

For each new page, feature, or major component, run through this cycle. Each phase has specific skills that should be invoked in order.

### Phase 1: Design & UX Review
**Trigger:** Before starting design work, after requirements are locked.

- **ui-ux-pro-max** — Deep interaction/motion/UX patterns. Use when: designing interactive states, complex component flows, motion specs, or polishing UX edge cases.
- **frontend-design** — Frontend design foundations and patterns. Use when: establishing visual design system, component design, layout patterns.
- **emil-design-eng** — Design engineering and implementation details. Use when: bridging design specs to implementable code, component architecture, design-to-code handoff.
- **apple-design** — Apple HCI patterns and guidelines. Use when: designing for consistency with macOS/iOS conventions, native-feeling interactions, or system integration.
- **animation-vocabulary** — Animation naming, taxonomy, and documentation. Use when: defining animation behaviors, creating animation specs, or documenting motion language.

### Phase 2: React Implementation
**Trigger:** When converting designs into code.

- **vercel-react-best-practices** — Performance patterns for React/Next.js. Use for: component structure, data fetching, bundle optimization, render strategies.
- **vercel-composition-patterns** — React composition architecture. Use for: component API design, reducing prop drilling, building flexible component libraries.

### Phase 3: Animation & Transitions
**Trigger:** When implementing interactive animations or page transitions.

- **vercel-react-view-transitions** — Native View Transition API. Use for: page transitions, route changes, shared element animations, animated list reorder, forward/back navigation animations.
- **improve-animations** — Animation polish and optimization. Use for: refining existing animations, reducing jank, ensuring smooth 60fps behavior.

### Phase 4: Performance & Shipping Audit
**Trigger:** Before merging or deploying to production.

- **vercel-optimize** — Cost and performance analysis. Use for: identifying expensive routes, optimization opportunities, bundle size, Vercel metrics review.
- **web-design-guidelines** — Design/accessibility compliance. Use for: checking UI against best practices, accessibility, responsive behavior.
- **writing-guidelines** — Copy and prose review. Use for: microcopy tone, error messages, clarity, voice consistency.

## Usage

When starting work on a new screen or feature:
1. **Design phase**: Invoke ui-ux-pro-max, apple-design as needed
2. **Build phase**: Invoke vercel-react-best-practices, vercel-composition-patterns
3. **Polish phase**: Invoke vercel-react-view-transitions, improve-animations for motion
4. **Ship phase**: Run full audit with vercel-optimize, web-design-guidelines, writing-guidelines

Example prompt: "Before we finalize this component, run it through Phase 2 & 3 of the audit cycle to check React patterns and animations."
