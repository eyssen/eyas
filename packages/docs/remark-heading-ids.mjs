// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Stable heading anchors for the handbook: `## Heading {#stable-id}` renders
// as `<h2 id="stable-id">Heading</h2>`. Every locale keeps the English id, so
// cross-page links (`/docs/<lang>/<page>/#stable-id`) and in-app help hashes
// (help-map.json) work in every language, and — unlike a raw `<h2 id>` — the
// heading stays in the page's "On this page" table of contents.
//
// Astro's heading-id pass keeps an id that is already set, so only headings
// without the suffix get a slug from their text. The locale-parity contract
// test (tests/contracts/handbook-locale-parity.test.ts) reads the same suffix.
//
// Dependency-free on purpose: it walks the mdast tree itself.

/** `{#id}` at the very end of a heading's text. */
export const HEADING_ID_SUFFIX = /\s*\{#([A-Za-z0-9][\w-]*)\}\s*$/;

/**
 * Set `data.hProperties.id` on one heading node when its last text child
 * ends in `{#id}`, and strip the suffix from the visible text.
 * Returns the id, or null when the heading carries none.
 */
export function applyHeadingId(node) {
  const children = node.children ?? [];
  const last = children[children.length - 1];
  if (!last || last.type !== 'text') return null;
  const match = HEADING_ID_SUFFIX.exec(last.value);
  if (!match) return null;
  last.value = last.value.slice(0, match.index);
  if (last.value === '') children.pop();
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: match[1] } };
  return match[1];
}

/** The remark plugin: every heading in the tree. */
export function remarkHeadingIds() {
  const visit = (node) => {
    if (node.type === 'heading') {
      applyHeadingId(node);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  return (tree) => visit(tree);
}
