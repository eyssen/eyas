// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface InteractiveElement {
  index: number
  tag: string
  role: string
  name: string
  type?: string
}

const INDEX_ATTR = 'data-eyas-index'

/**
 * Runs in the page. Stamps data-eyas-index on visible interactive nodes and
 * returns the compact list the agent clicks/fills by index.
 */
export const STAMP_INTERACTIVE_JS = `() => {
  const ATTR = '${INDEX_ATTR}';
  document.querySelectorAll('[' + ATTR + ']').forEach((el) => el.removeAttribute(ATTR));
  const selector = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]',
    '[role="radio"]', '[role="tab"]', '[role="menuitem"]', '[role="switch"]',
    '[contenteditable="true"]',
  ].join(',');
  const nodes = Array.from(document.querySelectorAll(selector));
  const visible = nodes.filter((el) => {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }).slice(0, 200);
  return visible.map((el, i) => {
    const index = i + 1;
    el.setAttribute(ATTR, String(index));
    const name = (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      (el instanceof HTMLInputElement ? el.value : '') ||
      (el.textContent || '').trim() ||
      el.getAttribute('href') ||
      ''
    ).replace(/\\s+/g, ' ').slice(0, 80);
    const type = el.getAttribute('type') || undefined;
    return {
      index,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name,
      type,
    };
  });
}`

export function indexSelector(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('Interactive index must be a positive integer from the last snapshot')
  }
  return `[${INDEX_ATTR}="${index}"]`
}

/**
 * Runs in the page. Turns the just-acted selector into a locator that survives
 * navigation (never `data-eyas-index`). Tagged `durableLocator` so tests can
 * stub `page.evaluate` without a live DOM.
 */
export const EXTRACT_LOCATOR_JS = `(selector) => {
  const durableLocator = true;
  void durableLocator;
  const el = document.querySelector(selector);
  if (!(el instanceof Element)) return null;
  const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\\]/g, '\\\\$&');
  if (el.id) return { kind: 'css', value: '#' + esc(el.id) };
  for (const attr of ['data-testid', 'data-test-id', 'data-test', 'data-cy']) {
    const v = el.getAttribute(attr);
    if (v) return { kind: 'css', value: '[' + attr + '="' + esc(v) + '"]' };
  }
  const nameAttr = el.getAttribute('name');
  if (nameAttr) return { kind: 'css', value: el.tagName.toLowerCase() + '[name="' + esc(nameAttr) + '"]' };
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (el.tagName === 'BUTTON' && type === 'submit') return { kind: 'css', value: 'button[type="submit"]' };
  if (el.tagName === 'INPUT' && type === 'submit') return { kind: 'css', value: 'input[type="submit"]' };
  const tag = el.tagName.toLowerCase();
  let role = el.getAttribute('role');
  if (!role) {
    if (tag === 'button' || (tag === 'input' && (type === 'button' || type === 'submit' || type === 'reset'))) role = 'button';
    else if (tag === 'a') role = 'link';
    else if (tag === 'input' || tag === 'textarea') role = 'textbox';
    else if (tag === 'select') role = 'combobox';
    else role = tag;
  }
  const label = (
    el.getAttribute('aria-label') ||
    (el.textContent || '').trim() ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title') ||
    ''
  ).replace(/\\s+/g, ' ').slice(0, 80);
  if (role && label) return { kind: 'role', role: role, name: label };
  return null;
}`

export function formatInteractiveSnapshot(elements: InteractiveElement[]): string {
  if (elements.length === 0) return '(no interactive elements)'
  return elements
    .map((el) => {
      const type = el.type ? ` type=${el.type}` : ''
      const name = el.name ? ` "${el.name}"` : ''
      return `[${el.index}] <${el.tag} role=${el.role}${type}>${name}`
    })
    .join('\n')
}
