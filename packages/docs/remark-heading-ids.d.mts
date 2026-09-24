// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Types for remark-heading-ids.mjs (the handbook's `{#id}` heading anchors).

export interface HeadingIdNode {
  type: string
  children?: HeadingIdNode[]
  value?: string
  data?: { hProperties?: Record<string, unknown> } & Record<string, unknown>
}

export declare const HEADING_ID_SUFFIX: RegExp

export declare function applyHeadingId(node: HeadingIdNode): string | null

export declare function remarkHeadingIds(): (tree: HeadingIdNode) => void
