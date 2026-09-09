---
title: Extensions
description: Install, enable, and review third-party skill packs without leaving MIT-compatible licenses.
---

**What this is for.** Extensions is the catalogue of skill packs and tools that could not be bundled with EYAS because of licensing. EYAS itself stays MIT. GPL, LGPL, AGPL, and SSPL (and similar copyleft) are not shipped inside the product; you opt in here, per pack, after reading the licence notice. Operators use this to add optional skills or companion tools without mixing forbidden licences into the core tree.

## When to use it

- You want a skill pack that is not in the bundled catalogue.
- You need a companion CLI or service (document conversion, antivirus, SAST) that EYAS talks to as a separate process.
- You must check whether a pack is MIT-compatible, copyleft, or proprietary before you install it.
- You want to disable a pack without uninstalling it, or remove it entirely.

## Typical workflow

1. Open the sidebar **Settings** group **Modules** → **Extensions** (`/extensions`).
2. Read **Auto-installable Packs** and **Third-Party Compatible Tools**. Each card shows name, licence badge, version, author, and skill count.
3. For an auto pack, click **Install**. Read the **License Notice**, then **Accept & Install** (or **Cancel**).
4. After install, use the power control to **Enable** / **Disable**, or the trash control to uninstall.
5. For a third-party pack, open **GitHub**, follow **Setup guide**, and install it yourself under that project’s licence. EYAS will not download it for you.

You should see an **Installed** badge and the header count of installed packs.

## Features

The page subtitle states the rule: some tools and skill packs could not be bundled; auto-install packs are downloaded by EYAS with your consent; third-party tools must be downloaded from their original source under their own licences.

Licence badges:

| Class | Meaning |
|-------|---------|
| MIT-compatible | MIT, Apache-2.0, BSD, ISC, Unlicense, and similar — bundleable in principle |
| Copyleft | GPL, LGPL, AGPL, MPL, CC-BY-SA, and similar — not bundled; install is an explicit opt-in. Copyleft packs that EYAS can fetch still run as a **separate process**, not linked into EYAS |
| Proprietary | Not distributed by EYAS; you download it yourself |
| Unknown | Licence string did not classify |

**Auto-installable Packs** are fetched as an archive (checksum verified when a SHA-256 is published), extracted under the data directory, and recorded with the licence you accepted. **Install** is refused unless you accept the notice. Manual packs cannot be auto-installed.

Enabled packs contribute their skill files to the [Skills](/docs/en/automation/skills/) catalogue. The card’s skill count is how many skills that pack declares (zero for most companion tools). Disable stops loading those skills; uninstall deletes the install directory and the DB row.

Do not install a pack whose licence you cannot comply with. EYAS remaining MIT does not waive the pack’s terms.

## Fields and controls

<h2 id="catalogue">Catalogue</h2>

| Control | Meaning |
|---------|---------|
| Installed count | Header: how many packs are installed |
| **Auto-installable Packs** | EYAS can download these after consent |
| **Third-Party Compatible Tools** | You download from the original source |
| Name / description / version / **by** author | Pack identity |
| Licence badge | SPDX id, coloured by compatibility class |
| **Installed** | This pack is on disk |
| Skill count | How many skills the pack declares |
| Tags | Search/filter chips when present |

<h2 id="install">Install, enable, disable</h2>

| Control | Meaning |
|---------|---------|
| **Install** | Start consent for an auto pack |
| **License Notice** | Full notice you must accept |
| **Accept & Install** | Sets licence accepted and downloads |
| **Cancel** | Dismiss the notice without installing |
| **Installing…** | Download in progress |
| Power | **Enable** / **Disable** an installed auto pack |
| Trash | Uninstall an installed auto pack |
| **GitHub** | Open the upstream page for a manual pack |
| **Setup guide** / **Hide details** | Expand or collapse the manual setup text |

<h2 id="recordly">Recordly (AGPL companion)</h2>

Recordly is a desktop screen recorder (zooms, cursor polish, webcam bubble). It is **AGPL-3.0**, so EYAS does not ship or auto-install it. The catalogue card is under **Third-Party Compatible Tools**. You download the app from GitHub, record and export **MP4/GIF** in Recordly, then attach the file in [Documents](/docs/en/knowledge/documents/). There is no `recordly_*` agent tool. Further cuts on this machine use [Video Use](/docs/en/studio/videouse/). This is **not** a [Studio](/docs/en/studio/) engine.

## Related

- [Settings overview](/docs/en/admin/settings/)
- [Notifications](/docs/en/admin/notifications/)
- [Remote nodes](/docs/en/admin/nodes/)
- [Hands](/docs/en/admin/hands/)
- [Skills](/docs/en/automation/skills/)
- [Tools](/docs/en/automation/tools/)
- [Studio](/docs/en/studio/)
- [Documents](/docs/en/knowledge/documents/)
