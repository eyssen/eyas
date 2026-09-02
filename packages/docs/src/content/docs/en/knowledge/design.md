---
title: "Design canvases"
description: "Draw UI, landing, print, or deck artboards — then attach them to a conversation or project."
---

**What this is for.** A design is a set of artboards on one pan-and-zoom canvas. You create, import, or ask an agent to draft it; you edit by hand, on the canvas, or by AI; you version it and attach it so the conversation can see it. The file format is Claude Design's; the runtime is EYAS's.

## When to use it

- You are designing a UI, a landing page, a print piece, or a slide deck and want it in EYAS, not only in an external tool.
- You want an agent to read named artboards (tokens, components, page) instead of guessing a look.
- You need to import a published Claude Design canvas, or export PNG/PDF.
- A conversation or project should carry the canvas on every turn.

## Typical workflow

1. Open **Design** in the sidebar (**Content** section) — route `/design`.
2. Type a name and press **New** (or **Import** a published canvas HTML).
3. Edit on the canvas, in **Source**, or via the **AI** panel. **Save** (one version per save).
4. In a conversation, use the **Designs** icon to attach it. The agent should then be able to fetch parts; you should see the canvas listed with a check.

A design is a set of artboards laid out on one pan-and-zoom canvas. Each artboard
is a `.dc.html` file; `canvas.json` records where each one sits, which page it
belongs to, and which view a fresh open lands on. Images live in the canvas under
their own filename.

The file format is the one Claude Design uses, so a canvas authored there imports
and renders here, and a canvas exported from here re-seeds there. EYAS renders it
with its own runtime — the two tools share a file format, not code.

## Creating a design

On `/design`, type a name and press **New**. You get a one-artboard starter to
replace.

**Import** takes the full HTML of a published design canvas page. A page whose
content lives in the hosting platform's own store rather than in the page itself
is refused: its embedded copy is only a stale first-open snapshot, and importing
it would quietly give you an old version.

You can also let an agent create one. Anything an agent produces goes through the
same checks as your own edits.

## Getting around the canvas

Drag the background to move. The wheel pans, **Shift**+wheel pans sideways, and
**Ctrl/⌘**+wheel zooms — the zoom is anchored on the pointer, so whatever is
under the cursor stays under the cursor. **Fit** frames everything on the page.

Panning works in the space around the artboards, not on top of them. An artboard
is an isolated frame that keeps its own mouse events, which is exactly what lets
an interactive prototype work.

When a canvas has several pages, the page buttons appear in the header.

## Opening one artboard

Next to each artboard's name is an open control — or double-click the name. The
artboard fills the viewport on its own, and **Esc** returns you to where you
were.

How it opens is a property of the artboard: by default the whole thing is shrunk
to fit, while an artboard marked to fill is widened to the viewport at its
natural scale and scrolls, which is what a fluid-width design wants.

## Three ways to edit

**On the canvas.** Open **Edit** and click an element. The properties panel
changes its typography, colour, box, border and layout; a grid whose columns are
all equal is edited as a plain column count. Text is editable in place unless it
comes from the artboard's logic — the panel says so rather than overwriting the
binding.

Cmd/Ctrl+Z undoes, Shift adds redo, and nothing is stored until you save: one
version per save, not one per keystroke.

An artboard marked interactive keeps its own controls working and is edited in
the Source panel instead — selecting elements would swallow the clicks its
prototype needs.

**In the source.** The Source panel lists every file in the canvas and edits it
directly.

**By AI.** Open the AI panel, describe the change, apply it.

Whatever the result, and whichever way it arrived, it is checked against the
canvas rules before it is stored: an artboard without a root element, a layout
entry pointing at a file that does not exist, an image reference with nothing
behind it, or a style attribute with a condition outside the braces — all of
these are rejected, and the previous version stays exactly as it was. If the
model's first attempt fails the check, EYAS shows it the specific problems and
asks once more.

This works the same with every configured provider. EYAS does not hand the job to
one vendor's tooling because that vendor happens to be configured; the prompt,
the checks and the stored result are identical either way.

An AI edit on a CLI provider can take several minutes on a large canvas. The
panel counts the time while it runs, and leaving the page does not cancel it.
Every attempt is recorded, so the panel still reports the last one afterwards —
applied, failed with the reason it failed, or interrupted by a server restart —
even if the page was reloaded or the connection dropped while the edit was
still going. While an edit is running, a second one cannot be started on the
same canvas.

## Tweaks

Tweak chips come from the artboard's own declared options. Changing one
re-renders immediately; pinning it writes the value back as the artboard's
default.

## Versions

Every change is a version, recorded with who made it, what it was, and whether it
came from a person, an import or the AI. Restoring an older version copies it
forward as a new one, so nothing is ever lost.

## Naming artboards so they can be found

Your agents do not read a whole canvas — see the next section. They read an index
that classifies each artboard by the role it plays, and a well-named artboard is
one they can find. The vocabulary:

| Role | What belongs in it |
|---|---|
| **tokens** | The palette, spacing, radii — the values everything else refers to |
| **typography** | The type scale, weights, faces |
| **components** | Buttons, inputs, badges: the pieces, in their states |
| **patterns** | Those pieces composed: cards, lists, toolbars |
| **page** | A whole screen or printed page |

The role is read from the artboard's title in `canvas.json`, then from its file
name. A design whose artboards are called *Tokens*, *Typography* and *Components*
is one an agent can navigate; five artboards called *Frame 1* to *Frame 5* have
to be opened at random. Designs generated by the AI are named this way already.

A design system canvas should carry at least a tokens artboard and a typography
artboard.

## Attaching a design

**To a conversation.** The **Designs** icon in a conversation's top bar attaches
a canvas to it. The count on the icon is how many are in play; the dropdown lists
every design with a tick on the attached ones. Agents can attach and detach
designs themselves.

**To a project.** Under **Projects → edit**. A conversation created in the
project starts with the project's designs attached and owns them from then on —
detaching one there affects only that conversation. Set them on the project and
new conversations get them; leave them empty and they do not. Changing a
project's designs later does not reach conversations that already exist.

This is the same behaviour as the project's code sources and working folders.

## What an agent sees of an attached design

Not the canvas — that would be tens of kilobytes on every turn. And not its
values either: an **announcement**. The design says it is attached, and says
what KIND of data each of its parts holds — tokens (colours, spacing, radii),
typography, components, patterns. For the five-artboard, 46 KB Odoo design that
is **652 characters**, and it stays that size as the design grows.

The agent then fetches only what it needs:

| Call | Returns |
|------|---------|
| `design_read` with `part` | The derived values for one part — colours, typefaces. Small. |
| `design_read` with `file` | One artboard's full markup, when markup is what is needed. |

**Why not simply include the palette?** It was included, for a while. The block
is paid on **every turn**; a fetch is paid **once**. At two turns the fetch is
already cheaper, and it is the only shape whose cost does not grow with the
canvas. The same arithmetic holds at every size, so even a small design is
announced rather than inlined.

The block also tells the agent to follow the design rather than merely noting
that one is attached — so what it produces in that conversation uses your
palette, your type and your component shapes.

## Exporting and printing

The export menu offers two kinds of thing.

**Files** gives you the canvas itself: a standalone HTML page that opens in any
browser, or a portable canvas document another tool can re-seed from.

**Print** renders the design through a real browser: PNG of the selected artboard
at normal or double resolution, PDF of the selected artboard, or one PDF of the
whole canvas.

How an artboard prints is a property of the artboard. A **fixed** artboard — the
default, and what a poster, flyer or brochure page is — comes out as exactly one
page at exactly its own size on the canvas. A **flow** artboard — a memo, a
report — paginates onto A4 or Letter, whichever you pick in the menu; a column
wider than the page is scaled down to fit, and a narrower one is left at the
width it was designed at rather than being blown up.

A whole-canvas PDF puts each artboard on its own page, in the order you would
read them off the canvas: page by page, then top to bottom, then left to right.
Pages keep their own sizes, so a brochure of differently-sized artboards exports
correctly instead of being forced onto one paper size.

Printing needs a browser installed alongside EYAS. Without one the print items
are disabled and the menu says what to install. Everything under **Files** works
either way.

## Renaming and deleting

Click the title in the header, type, press Enter. Esc cancels.

The bin icon at the right of the header deletes the whole design. It asks first,
and the question names what goes with it: every saved version, and every
conversation or project the design is attached to. There is no undo and no
trash to recover it from.
