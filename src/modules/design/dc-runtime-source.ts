// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/dc-runtime-source.ts
//
// The Design Component runtime, as a self-contained script string.
//
// It ships as a STRING because it has to execute inside the artboard's
// sandboxed iframe: `setState` re-renders, so template expansion cannot happen
// once in the app and be shipped as static DOM. It has no imports, touches no
// EYAS API, and assumes nothing but a DOM.
//
// Everything it runs is untrusted, AI- or cross-user-authored code. The
// isolation that makes that acceptable is set up by dc-render.ts — a srcdoc
// iframe with `sandbox="allow-scripts"` and NO `allow-same-origin`, plus a CSP
// with `connect-src 'none'`. Nothing in this file may weaken either, and the
// runtime deliberately exposes no bridge back to the host beyond a
// postMessage height report.
//
// Semantics implemented, from the Design Components format:
//   {{ dotted.path }}      lookup only — never an expression
//   {{ $index }}           loop index
//   attr="{{ path }}"      raw value (function on an on* attr becomes a listener)
//   attr="a {{p}} b"       interpolated string
//   <sc-for list as>       repeat, with `as` and $index in scope
//   <sc-if value>          branch
//   <dc-import name>       mount a sibling artboard, attrs become props
//   class Component extends DCLogic { renderVals() }

export const DC_RUNTIME_SOURCE = String.raw`
(function () {
  'use strict';

  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;

  function isPlainPath(expr) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z0-9_$]+)*$/.test(expr);
  }

  // Literals the format admits inside a hole. Anything else that is not a
  // dotted path resolves to undefined — the documented silent behaviour.
  function literalOf(expr) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^'[^']*'$/.test(expr) || /^"[^"]*"$/.test(expr)) return expr.slice(1, -1);
    return undefined;
  }

  function lookup(scope, expr) {
    if (!expr) return undefined;
    var literal = literalOf(expr);
    if (literal !== undefined) return literal;
    if (!isPlainPath(expr)) return undefined;
    var parts = expr.split('.');
    var cur = scope;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function toText(value) {
    if (value === null || value === undefined || value === false) return '';
    return String(value);
  }

  function interpolate(text, scope) {
    return text.replace(HOLE, function (_m, expr) { return toText(lookup(scope, expr)); });
  }

  /** A whole-value hole returns the RAW value; anything else is a string. */
  function attrValue(raw, scope) {
    var whole = raw.match(/^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/);
    if (whole) return lookup(scope, whole[1]);
    return interpolate(raw, scope);
  }

  var ATTR_ALIASES = { classname: 'class', htmlfor: 'for' };

  // The HTML parser lowercases attribute names, so the format's documented
  // JSX spelling (onClick) arrives here as "onclick". Match case-insensitively
  // and let the RESOLVED VALUE decide: a function becomes a listener, and an
  // on* attribute that is not a function is dropped rather than turned into an
  // inline handler, which is not part of the format.
  function eventNameOf(attrName) {
    if (!/^on[a-z]/i.test(attrName)) return null;
    return attrName.slice(2).toLowerCase();
  }

  var SRC_ATTR = 'data-dc-i';

  // Parse once and stamp every element with a stable document-order index.
  // The index is what lets the app address an element across the sandbox
  // boundary without ever touching this document.
  function parseTemplate(doc, html) {
    var tpl = doc.createElement('template');
    tpl.innerHTML = html;
    var all = tpl.content.querySelectorAll('*');
    var nodes = [];
    for (var i = 0; i < all.length; i++) {
      all[i].setAttribute(SRC_ATTR, String(i));
      nodes.push(all[i]);
    }
    return { content: tpl.content, template: tpl, nodes: nodes };
  }

  /** Serialise the template back to source, without the editing indices. */
  function serialiseTemplate(doc, tpl) {
    var clone = doc.createElement('template');
    clone.innerHTML = tpl.innerHTML;
    var all = clone.content.querySelectorAll('[' + SRC_ATTR + ']');
    for (var i = 0; i < all.length; i++) all[i].removeAttribute(SRC_ATTR);
    return clone.innerHTML;
  }

  /** Split a style attribute into ordered declarations, holes preserved. */
  function parseStyle(value) {
    var out = [];
    var parts = String(value || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var chunk = parts[i];
      if (!chunk || !chunk.trim()) continue;
      var colon = chunk.indexOf(':');
      if (colon === -1) continue;
      out.push([chunk.slice(0, colon).trim(), chunk.slice(colon + 1).trim()]);
    }
    return out;
  }

  function styleToObject(value) {
    var decls = parseStyle(value);
    var obj = {};
    for (var i = 0; i < decls.length; i++) obj[decls[i][0]] = decls[i][1];
    return obj;
  }

  /**
   * Patch named properties, leaving every other declaration byte-identical —
   * including ones whose value is a {{hole}}, which a DOM style API would
   * silently destroy.
   */
  function patchStyle(value, patch) {
    var decls = parseStyle(value);
    var seen = {};
    var out = [];
    for (var i = 0; i < decls.length; i++) {
      var name = decls[i][0];
      if (Object.prototype.hasOwnProperty.call(patch, name)) {
        seen[name] = true;
        if (patch[name] === null || patch[name] === '') continue;
        out.push(name + ': ' + patch[name]);
      } else {
        out.push(name + ': ' + decls[i][1]);
      }
    }
    for (var key in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      if (seen[key] || patch[key] === null || patch[key] === '') continue;
      out.push(key + ': ' + patch[key]);
    }
    return out.join('; ');
  }

  function hintSize(value) {
    if (!value) return null;
    var parts = String(value).split(',');
    return { width: (parts[0] || '').trim(), height: (parts[1] || '').trim() };
  }

  // ── expansion ─────────────────────────────────────────────────────────────

  function expandNodes(doc, nodes, scope, ctx) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var produced = expandNode(doc, nodes[i], scope, ctx);
      for (var j = 0; j < produced.length; j++) out.push(produced[j]);
    }
    return out;
  }

  function expandNode(doc, node, scope, ctx) {
    if (node.nodeType === 3) {
      return [doc.createTextNode(interpolate(node.nodeValue || '', scope))];
    }
    if (node.nodeType === 8) return [];
    if (node.nodeType !== 1) return [node.cloneNode(true)];

    var tag = node.tagName.toLowerCase();

    if (tag === 'sc-for') {
      var listRaw = node.getAttribute('list') || '';
      var alias = node.getAttribute('as') || 'item';
      var list = attrValue(listRaw, scope);
      if (!Array.isArray(list)) {
        var hint = parseInt(node.getAttribute('hint-placeholder-count') || '0', 10);
        list = [];
        for (var h = 0; h < hint; h++) list.push({});
      }
      var repeated = [];
      for (var k = 0; k < list.length; k++) {
        var childScope = Object.create(scope);
        childScope[alias] = list[k];
        childScope.$index = k;
        var made = expandNodes(doc, Array.prototype.slice.call(node.childNodes), childScope, ctx);
        for (var m = 0; m < made.length; m++) repeated.push(made[m]);
      }
      return repeated;
    }

    if (tag === 'sc-if') {
      var cond = attrValue(node.getAttribute('value') || '', scope);
      if (!cond) return [];
      return expandNodes(doc, Array.prototype.slice.call(node.childNodes), scope, ctx);
    }

    if (tag === 'dc-import') {
      var name = node.getAttribute('name') || '';
      var childProps = {};
      for (var a = 0; a < node.attributes.length; a++) {
        var att = node.attributes[a];
        var an = att.name;
        if (an === 'name' || an === SRC_ATTR || an.indexOf('hint-') === 0) continue;
        // kebab-case attributes become camelCase props
        var propName = an.replace(/-([a-z])/g, function (_s, c) { return c.toUpperCase(); });
        childProps[propName] = attrValue(att.value, scope);
      }
      var host = doc.createElement('div');
      host.setAttribute('data-dc-import', name);
      var size = hintSize(node.getAttribute('hint-size'));
      if (size) {
        if (size.width) host.style.width = size.width;
        if (size.height) host.style.height = size.height;
      }
      var childSpec = ctx.imports && ctx.imports[name];
      if (!childSpec) {
        host.setAttribute('data-dc-missing', '1');
        host.textContent = 'Missing component: ' + name;
      } else {
        mountInto(doc, host, childSpec, childProps, ctx);
      }
      return [host];
    }

    var el = doc.createElement(node.tagName);
    for (var b = 0; b < node.attributes.length; b++) {
      var attr = node.attributes[b];
      var lower = attr.name.toLowerCase();
      var mapped = ATTR_ALIASES[lower] || attr.name;
      var evt = eventNameOf(attr.name);
      var value = attrValue(attr.value, scope);
      if (evt) {
        if (typeof value === 'function') el.addEventListener(evt, value);
        continue;
      }
      if (value === false || value === null || value === undefined) continue;
      if (value === true) { el.setAttribute(mapped, ''); continue; }
      if (typeof value === 'object' || typeof value === 'function') continue;
      el.setAttribute(mapped, String(value));
    }
    var kids = expandNodes(doc, Array.prototype.slice.call(node.childNodes), scope, ctx);
    for (var n = 0; n < kids.length; n++) el.appendChild(kids[n]);
    return [el];
  }

  // ── logic ─────────────────────────────────────────────────────────────────

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state) : patch;
    for (var key in next) if (Object.prototype.hasOwnProperty.call(next, key)) this.state[key] = next[key];
    if (this.__rerender) this.__rerender();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__rerender) this.__rerender(); };
  DCLogic.prototype.renderVals = function () { return {}; };

  function buildComponent(logicSource, props) {
    if (!logicSource) return new DCLogic(props);
    var factory;
    try {
      // eslint-disable-next-line no-new-func
      factory = new Function('DCLogic', logicSource + '\nreturn Component;');
    } catch (e) {
      throw new Error('artboard logic failed to compile: ' + (e && e.message ? e.message : e));
    }
    var Ctor;
    try {
      Ctor = factory(DCLogic);
    } catch (e) {
      // A logic block that declares no Component reaches the trailing
      // trailing 'return Component' and throws a ReferenceError at call time.
      throw new Error('artboard logic did not define "class Component extends DCLogic" (' + (e && e.message ? e.message : e) + ')');
    }
    if (typeof Ctor !== 'function') throw new Error('artboard logic did not define "class Component extends DCLogic"');
    var instance = new Ctor(props);
    if (!(instance instanceof DCLogic)) {
      // A class that does not extend DCLogic still works, but must be given
      // the base surface it is documented to have.
      if (!instance.state) instance.state = {};
      if (!instance.setState) instance.setState = DCLogic.prototype.setState;
      if (!instance.forceUpdate) instance.forceUpdate = DCLogic.prototype.forceUpdate;
      if (!instance.props) instance.props = props;
    }
    return instance;
  }

  function mountInto(doc, host, spec, props, ctx) {
    var merged = {};
    var defaults = spec.defaults || {};
    for (var d in defaults) if (Object.prototype.hasOwnProperty.call(defaults, d)) merged[d] = defaults[d];
    for (var p in props) if (Object.prototype.hasOwnProperty.call(props, p)) merged[p] = props[p];

    var component;
    try {
      component = buildComponent(spec.logic, merged);
    } catch (e) {
      host.setAttribute('data-dc-error', '1');
      host.textContent = String(e && e.message ? e.message : e);
      return;
    }

    var currentTemplate = spec.template || '';
    var parsed = null;

    function render() {
      var vals;
      try {
        vals = component.renderVals ? component.renderVals() : {};
      } catch (e) {
        host.setAttribute('data-dc-error', '1');
        host.textContent = 'renderVals() threw: ' + (e && e.message ? e.message : e);
        return;
      }
      var scope = {};
      for (var v in vals) if (Object.prototype.hasOwnProperty.call(vals, v)) scope[v] = vals[v];
      scope.props = merged;
      scope.state = component.state;

      // Re-parse every render: the template may have been edited in place, and
      // expansion consumes the node list.
      parsed = parseTemplate(doc, currentTemplate);
      var expanded = expandNodes(doc, Array.prototype.slice.call(parsed.content.childNodes), scope, ctx);
      while (host.firstChild) host.removeChild(host.firstChild);
      for (var i = 0; i < expanded.length; i++) host.appendChild(expanded[i]);
      if (ctx.onRender) ctx.onRender();
    }

    component.__rerender = render;
    render();

    // The editing surface. Only the root artboard is wired to the message
    // channel; an imported child is edited through its own artboard.
    host.__dcEdit = {
      styleOf: function (index) {
        if (!parsed || !parsed.nodes[index]) return null;
        return styleToObject(parsed.nodes[index].getAttribute('style'));
      },
      tagOf: function (index) {
        return parsed && parsed.nodes[index] ? parsed.nodes[index].tagName.toLowerCase() : null;
      },
      textOf: function (index) {
        var node = parsed && parsed.nodes[index];
        if (!node) return null;
        if (node.childNodes.length !== 1 || node.childNodes[0].nodeType !== 3) return null;
        return node.childNodes[0].nodeValue;
      },
      setStyle: function (index, patch) {
        if (!parsed || !parsed.nodes[index]) return null;
        var node = parsed.nodes[index];
        var next = patchStyle(node.getAttribute('style'), patch);
        if (next) node.setAttribute('style', next);
        else node.removeAttribute('style');
        currentTemplate = serialiseTemplate(doc, parsed.template);
        render();
        return currentTemplate;
      },
      setText: function (index, text) {
        if (!parsed || !parsed.nodes[index]) return null;
        var node = parsed.nodes[index];
        while (node.firstChild) node.removeChild(node.firstChild);
        node.appendChild(doc.createTextNode(String(text)));
        currentTemplate = serialiseTemplate(doc, parsed.template);
        render();
        return currentTemplate;
      },
      setProps: function (next) {
        for (var k in next) if (Object.prototype.hasOwnProperty.call(next, k)) merged[k] = next[k];
        component.props = merged;
        render();
      },
      source: function () { return currentTemplate; },
    };
    if (typeof component.componentDidMount === 'function') {
      try { component.componentDidMount(); } catch (e) { /* a lifecycle throw must not blank the artboard */ }
    }
  }

  /**
   * Resolve bare-filename image references to the data URIs the host passed
   * in. Literal substitution, exactly as the format specifies — which is also
   * why the validator checks every reference has a files entry.
   */
  function resolveImages(html, images) {
    if (!images) return html;
    return html.replace(/(src|href)="\.?\/?([^"]+)"/g, function (whole, attr, name) {
      var hit = images[name];
      return hit ? attr + '="' + hit + '"' : whole;
    }).replace(/url\(\s*['"]?\.?\/?([^'")]+)['"]?\s*\)/g, function (whole, name) {
      var hit = images[name];
      return hit ? 'url(' + hit + ')' : whole;
    });
  }

  function mountArtboard(doc, spec) {
    var root = doc.getElementById('dc-root');
    if (!root) {
      root = doc.createElement('div');
      root.id = 'dc-root';
      doc.body.appendChild(root);
    }

    if (spec.helmet) {
      var helmetHost = doc.createElement('div');
      helmetHost.innerHTML = resolveImages(spec.helmet, spec.images);
      var nodes = Array.prototype.slice.call(helmetHost.childNodes);
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 1 && nodes[i].tagName.toLowerCase() === 'script') continue;
        doc.head.appendChild(nodes[i]);
      }
    }

    var ctx = {
      imports: {},
      onRender: function () {
        if (typeof spec.reportHeight === 'function') spec.reportHeight();
      },
    };
    var imports = spec.imports || {};
    for (var name in imports) {
      if (!Object.prototype.hasOwnProperty.call(imports, name)) continue;
      var imported = imports[name];
      ctx.imports[name] = {
        template: resolveImages(imported.template || '', spec.images),
        logic: imported.logic || null,
        defaults: imported.defaults || {},
      };
    }

    mountInto(doc, root, {
      template: resolveImages(spec.template || '', spec.images),
      logic: spec.logic || null,
      defaults: spec.defaults || {},
    }, spec.props || {}, ctx);

    var post = typeof spec.post === 'function'
      ? spec.post
      : function (message) {
          try { parent.postMessage(message, '*'); } catch (e) { /* no parent */ }
        };
    var editor = wireEditor(doc, root, post);
    if (typeof window !== 'undefined') {
      window.__dcEditor = editor;
      window.addEventListener('message', function (event) {
        // Only the embedder may drive the editor.
        if (event.source !== parent) return;
        editor.handle(event.data);
      });
    }
    return editor;
  }

  var SELECTION_STYLE_ID = 'dc-selection-style';
  var SELECTION_CSS = '[data-dc-selected]{outline:2px solid #1f4ed8 !important;outline-offset:1px}';

  /**
   * Wire the artboard to the app across the sandbox boundary.
   *
   * Only ever posts to the parent; never reads from the app's document, which it
   * could not reach anyway. Selection is opt-in per mode so an interactive
   * artboard's own handlers keep working.
   */
  function wireEditor(doc, host, post) {
    // Default to 'interact', not 'edit': the canvas shows working prototypes,
    // and selection swallows the artboard's own handlers, so entering edit mode
    // has to be a deliberate act by the app.
    var mode = 'interact';
    var selected = null;

    if (!doc.getElementById(SELECTION_STYLE_ID)) {
      var style = doc.createElement('style');
      style.id = SELECTION_STYLE_ID;
      style.textContent = SELECTION_CSS;
      doc.head.appendChild(style);
    }

    function paintSelection() {
      var previous = doc.querySelectorAll('[data-dc-selected]');
      for (var i = 0; i < previous.length; i++) previous[i].removeAttribute('data-dc-selected');
      if (selected === null) return;
      var target = doc.querySelector('[data-dc-i="' + selected + '"]');
      if (target) target.setAttribute('data-dc-selected', '');
    }

    function reportSelection(index) {
      var api = host.__dcEdit;
      if (!api) return;
      selected = index;
      paintSelection();
      if (index === null) return;
      var text = api.textOf(index);
      post({
        type: 'dc:selected',
        index: index,
        tag: api.tagOf(index) || 'div',
        styles: api.styleOf(index) || {},
        text: text === null ? undefined : text,
        bound: text !== null && /\{\{[\s\S]*\}\}/.test(text),
      });
    }

    doc.addEventListener('click', function (event) {
      if (mode !== 'edit') return;
      var node = event.target;
      while (node && node !== doc.body && !(node.getAttribute && node.getAttribute(SRC_ATTR) !== null)) {
        node = node.parentNode;
      }
      if (!node || !node.getAttribute || node.getAttribute(SRC_ATTR) === null) return;
      // In edit mode the artboard's own handlers must not also fire.
      event.preventDefault();
      event.stopPropagation();
      reportSelection(parseInt(node.getAttribute(SRC_ATTR), 10));
    }, true);

    return {
      handle: function (message) {
        var api = host.__dcEdit;
        if (!api || !message || typeof message !== 'object') return;
        switch (message.type) {
          case 'dc:select':
            reportSelection(message.index === null ? null : parseInt(message.index, 10));
            return;
          case 'dc:setStyle': {
            var body = api.setStyle(parseInt(message.index, 10), message.styles || {});
            if (body !== null) { paintSelection(); post({ type: 'dc:source', body: body, index: selected }); }
            return;
          }
          case 'dc:setText': {
            var next = api.setText(parseInt(message.index, 10), String(message.text == null ? '' : message.text));
            if (next !== null) { paintSelection(); post({ type: 'dc:source', body: next, index: selected }); }
            return;
          }
          case 'dc:setProps':
            api.setProps(message.props || {});
            paintSelection();
            return;
          case 'dc:setMode':
            mode = message.mode === 'interact' ? 'interact' : 'edit';
            if (mode === 'interact') { selected = null; paintSelection(); }
            return;
          default:
            return;
        }
      },
    };
  }

  // Exposed for the host page's tests and for the bootstrap below.
  if (typeof window !== 'undefined') {
    window.__dcMountArtboard = function (spec) { return mountArtboard(document, spec); };
    window.__dcInternals = { lookup: lookup, interpolate: interpolate, attrValue: attrValue };
    if (window.__DC_ARTBOARD__) {
      try {
        mountArtboard(document, window.__DC_ARTBOARD__);
      } catch (e) {
        document.body.setAttribute('data-dc-error', '1');
        document.body.textContent = String(e && e.message ? e.message : e);
      }
    }
  }
})();
`
