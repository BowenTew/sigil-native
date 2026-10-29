# ADR 0001: Architecture — why Sigil looks like "React Native's model-facing subset"

Status: accepted (initial)

## Context

LLM-generated UI needs a path from model output to native pixels. Direct
codegen (model writes React/Swift) fails in production: the output space is
too large, too easy to get subtly wrong, and impossible to validate before it
reaches the user. OpenAI's Intelligent UI (reverse-engineered) shows a
different shape: a constrained streaming language compiled to a JS program,
executed in a sandbox, diffed into platform-neutral operations, applied by
native renderers.

## Decision

1. **Language is the model's prior art**: Markdown + JSX-like tags + JS. No
   novel syntax to learn; reliability comes from familiarity.
2. **Streaming tolerance is a language feature**: any prefix must compile;
   incomplete constructs are dropped/repaired with diagnostics.
3. **Compile once, on the engine side**: clients never parse Sigil; they
   evaluate a plain JS program (`__sigil.jsx(...)` calls) and apply ops.
4. **SigilOps is the public contract**: renderers (Web/iOS/Android) depend
   only on the op protocol, not on the language or compiler.
5. **Interactions are local by default**: state lives in the runtime;
   handlers cross the boundary as `(fnId, args)`; the model is called only
   via `Sigil.issueNewTurn`.
6. **Layout is quantized**: design tokens + catalog components instead of
   free flexbox. Layout is where models fail; the design system owns it.

## Consequences

- The runtime must be zero-DOM and isomorphic (Web Worker / JavaScriptCore /
  Node) — one implementation, every platform.
- The catalog is a single source of truth (`@sigil-native/lang`): compiler
  validation, prompt generation, and renderer conformance derive from it.
- React Native analogies are intentional: reconciler + native instructions;
  we adopt its _shape_ while making the instruction protocol public.

## References

- "How ChatGPT's Intelligent UI works" — openui.com/blog
- React Native Fabric: ShadowViewMutation / MountingManager
