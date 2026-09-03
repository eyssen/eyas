#!/usr/bin/env python3
"""Extract and re-insert the language variants of the EYAS landing page.

The landing page (docs/eyas-overview.html) carries every user-facing string once
per language, as sibling elements distinguished by a language class:

    <span class="hu">Magyar</span><span class="en">English</span>

CSS shows exactly one of them (see [data-lang="xx"] rules). This script keeps that
structure honest across six languages:

    extract  -> JSON of every language group (source of truth for translators)
    apply    -> writes the translated variants back next to their siblings

Nested markup inside a variant (e.g. <span class="gradient">) is preserved verbatim,
so translators must keep those inner tags intact.

Ids are positional (s0000, s0001, ...), so extract -> translate -> apply is one cycle:
adding or removing a string in the page shifts every id after it, and translation files
from an earlier extract no longer line up. Re-extract instead of reusing them.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "docs" / "eyas-overview.html"
LANGS = ["en", "hu", "de", "es", "fr", "tlh"]
BASE_LANGS = ["hu", "en"]  # the two that already exist in the page


def find_groups(html):
    """Return the language groups: runs of adjacent <span|tspan class="<lang>"> siblings.

    Scanning is tag-aware rather than regex-based: a variant may contain nested
    spans, so the closing tag is found by counting depth.
    """
    groups = []
    pos = 0
    open_re = re.compile(r'<(span|tspan) class="(%s)">' % "|".join(LANGS))
    while True:
        m = open_re.search(html, pos)
        if not m:
            break
        tag = m.group(1)
        group = {"tag": tag, "start": m.start(), "variants": {}, "seps": []}
        cursor = m.start()
        pending_sep = None
        while True:
            m2 = open_re.match(html, cursor)
            if not m2 or m2.group(1) != tag:
                break
            if pending_sep is not None:
                group["seps"].append(pending_sep)
            lang = m2.group(2)
            inner_start = m2.end()
            depth = 1
            scan = inner_start
            tag_re = re.compile(r"</?%s\b" % tag)
            while depth:
                m3 = tag_re.search(html, scan)
                if not m3:
                    raise SystemExit("unbalanced <%s> at offset %d" % (tag, m2.start()))
                depth += -1 if m3.group(0).startswith("</") else 1
                scan = m3.end()
            close = html.index(">", scan) + 1
            group["variants"][lang] = html[inner_start : close - len("</%s>" % tag)]
            cursor = close
            # Whitespace between sibling variants is significant: only one variant is
            # displayed, so a swallowed newline would silently drop a rendered space.
            pending_sep = None
            ws = re.match(r"\s*", html[cursor:])
            if ws and open_re.match(html, cursor + ws.end()):
                pending_sep = html[cursor : cursor + ws.end()]
                cursor += ws.end()
        group["end"] = cursor
        groups.append(group)
        pos = cursor
    return groups


def cmd_extract(out_path):
    html = PAGE.read_text(encoding="utf-8")
    groups = find_groups(html)
    items, bad = [], []
    for i, g in enumerate(groups):
        got = set(g["variants"])
        if got != set(BASE_LANGS):
            bad.append((i, sorted(got)))
        items.append(
            {
                "id": "s%04d" % i,
                "tag": g["tag"],  # tspan = inline SVG label, no text wrapping
                "en": g["variants"].get("en", ""),
                "hu": g["variants"].get("hu", ""),
            }
        )
    Path(out_path).write_text(
        json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("groups: %d  (tspan: %d)" % (len(items), sum(1 for i in items if i["tag"] == "tspan")))
    if bad:
        print("UNEXPECTED variant sets in %d group(s): %s" % (len(bad), bad[:5]))
    print("written: %s" % out_path)


def cmd_apply(translations_dir):
    html = PAGE.read_text(encoding="utf-8")
    groups = find_groups(html)
    loaded = {}
    for lang in LANGS:
        if lang in BASE_LANGS:
            continue
        p = Path(translations_dir) / ("%s.json" % lang)
        if not p.exists():
            print("skip %s (no %s)" % (lang, p))
            continue
        loaded[lang] = {d["id"]: d["text"] for d in json.loads(p.read_text(encoding="utf-8"))}
    if not loaded:
        raise SystemExit("no translation files found")

    # Rewrite back-to-front so earlier offsets stay valid.
    for i in range(len(groups) - 1, -1, -1):
        g = groups[i]
        gid = "s%04d" % i
        tag = g["tag"]
        el = lambda lang, text: '<%s class="%s">%s</%s>' % (tag, lang, text, tag)
        present = [l for l in BASE_LANGS if l in g["variants"]]
        seps = list(g["seps"])
        # Reuse the separator the page already uses between variants of this group.
        filler = seps[-1] if seps else ""
        out = el(present[0], g["variants"][present[0]])
        for idx, lang in enumerate(present[1:]):
            out += (seps[idx] if idx < len(seps) else filler) + el(lang, g["variants"][lang])
        for lang in [l for l in LANGS if l not in BASE_LANGS]:
            if lang not in loaded:
                continue
            if gid not in loaded[lang]:
                raise SystemExit("missing %s translation for %s" % (lang, gid))
            out += filler + el(lang, loaded[lang][gid])
        html = html[: g["start"]] + out + html[g["end"] :]

    PAGE.write_text(html, encoding="utf-8")
    print("applied %s to %d groups" % (", ".join(sorted(loaded)), len(groups)))


TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
ENTITY_RE = re.compile(r"&[a-zA-Z]+;|&#\d+;")
# Escaping entities stand for a literal character the browser must not parse as
# markup - losing one changes what the page renders. The rest are typography and
# may legitimately differ per language (Spanish has no possessive apostrophe).
STRUCTURAL_ENTITIES = {"&lt;", "&gt;", "&amp;"}


def signature(text):
    """Markup fingerprint a translation must reproduce exactly."""
    entities = [e for e in ENTITY_RE.findall(text) if e in STRUCTURAL_ENTITIES]
    return sorted(TAG_RE.findall(text)), sorted(entities)


def typography(text):
    return sorted(e for e in ENTITY_RE.findall(text) if e not in STRUCTURAL_ENTITIES)


def cmd_verify(translations_dir):
    """Check every translation file against the page's own strings."""
    html = PAGE.read_text(encoding="utf-8")
    groups = find_groups(html)
    source = [
        {"id": "s%04d" % i, "tag": g["tag"], "en": g["variants"]["en"]}
        for i, g in enumerate(groups)
        if "en" in g["variants"]
    ]
    by_id = {d["id"]: d for d in source}
    failed = False
    for lang in LANGS:
        if lang in BASE_LANGS:
            continue
        path = Path(translations_dir) / ("%s.json" % lang)
        if not path.exists():
            print("%-4s MISSING %s" % (lang, path))
            failed = True
            continue
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print("%-4s INVALID JSON: %s" % (lang, exc))
            failed = True
            continue
        problems, notes = [], []
        if len(items) != len(source):
            problems.append("count %d != %d" % (len(items), len(source)))
        seen = set()
        for item in items:
            sid, text = item.get("id"), item.get("text", "")
            if sid not in by_id:
                problems.append("unknown id %s" % sid)
                continue
            seen.add(sid)
            src = by_id[sid]
            if signature(text) != signature(src["en"]):
                problems.append("markup mismatch at %s" % sid)
            if typography(text) != typography(src["en"]):
                notes.append(sid)
            if not text.strip():
                problems.append("empty at %s" % sid)
            # SVG labels do not wrap; an overlong one silently overflows the diagram
            if src["tag"] == "tspan" and len(text) > len(src["en"]) * 1.15:
                problems.append(
                    "tspan %s too long (%d > %d)" % (sid, len(text), len(src["en"]))
                )
        missing = set(by_id) - seen
        if missing:
            problems.append("missing %d id(s): %s" % (len(missing), sorted(missing)[:5]))
        if problems:
            failed = True
            print("%-4s FAIL (%d)" % (lang, len(problems)))
            for line in problems[:15]:
                print("       - %s" % line)
            if len(problems) > 15:
                print("       … %d more" % (len(problems) - 15))
        else:
            print("%-4s OK  (%d strings)" % (lang, len(items)))
        if notes:
            print("       typography entities differ in %d string(s): %s%s"
                  % (len(notes), ", ".join(notes[:8]), " …" if len(notes) > 8 else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in {"extract", "apply", "verify"}:
        raise SystemExit(
            "usage: landing-i18n.py extract <out.json> | apply <dir> | verify <dir>"
        )
    cmd = {"extract": cmd_extract, "apply": cmd_apply, "verify": cmd_verify}[sys.argv[1]]
    sys.exit(cmd(sys.argv[2]) or 0)
