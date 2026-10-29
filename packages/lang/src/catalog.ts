// Single source of truth for the Sigil component catalog.
//
// The compiler validates model output against these tags; system prompts for
// the LLM are generated from the same list; renderers implement exactly these
// components. If you add a component, add it here first, then implement it in
// every renderer.

export const CATALOG_TAGS = [
  'box',
  'title',
  'text',
  'caption',
  'bold',
  'chip',
  'divider',
  'slider',
  'checkbox',
  'button',
  'barchart',
] as const

export type CatalogTag = (typeof CATALOG_TAGS)[number]

export function isCatalogTag(tag: string): tag is CatalogTag {
  return (CATALOG_TAGS as readonly string[]).includes(tag)
}

// Design tokens. The model uses integer steps, not raw CSS values; renderers
// map steps to platform-specific units. Spacing: 1 step = 4px on web.
export const TOKENS = {
  spacing: 4,
  radius: { sm: 6, md: 10, lg: 14 },
  fontSize: { md: 15, lg: 19, xl: 24 },
} as const

// Ops protocol version (see spec/sigil-ops.spec.md).
export const OPS_PROTOCOL_VERSION = 1
