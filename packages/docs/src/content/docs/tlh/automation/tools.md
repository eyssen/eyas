---
title: janmey
description: chellu' 'ej chel janmey, ghoqwI'pu' tlhoblaH.
---

**He:** `/tools`.

janmey **tlhoblaH laHmey** 'oH (De' tlhegh, shell, leghwI', HTTP, nej, yoS ra'chuq, MCP janmey, …). ghoqwI'Daq nob ghoqwI' **SeH** navDaq (`Tools` tlhegh vegh tetlh) 'ej chaw'mey / Hub lojmIt je.

| qech | QIj |
|------|-----|
| jan pong | ghoqwI' SeH qaw je lo' taH ID |
| Del | nuq ta' jan (tetlhDaq 'anglu') |
| chaw'mey | CASL / lojmIt vum poH tlhob botlaH |
| Qan pa' | janmey puS SeHlu' DaqmeyDaq vum |

MCP janmey [MCP jabbI'IDmey](/docs/tlh/ai/mcp/) yISeH. Hur pat pegh mu'mey [ra'chuqmey](/docs/tlh/admin/connections/).

---

## chellu' jan ghommey (jen)

### ngoq yoS (pat Hoch)

wa'DIch De' tlhegh janmey — **Hoch** pat (Grok, Claude API, Kimi, nIH, …) ngoq choHlaH, Claude Code SDK pat janmey wuvbe':

| jan | meq | Qob |
|-----|-----|-----|
| `read_file` | ghItlh tejey yIlaD (tlhegh poH / 'aqroS) | SuD |
| `write_file` | tejey yIchu' / yIqa'chu' | SuD 'ej Doq |
| `edit_file` | mu' naQ qa' (meq choH) | SuD 'ej Doq |
| `grep` | vum Daq bIngDaq ghItlh nej | SuD |
| `glob` | pab lo' tejey nej | SuD |
| `git_status` / `git_diff` | laD neH bej QaH | SuD |
| `run_command` | shell Hutlh mIw vum (laj) | Doq |

Hemey vum Daq pagh ghoqwI' **vum Sor**Daq Qanlu'. pegh Hemey (`.env`, `master.key`, `.ssh`, …) chaw'be'lu'. naQ tejey qa'chu' lu' `edit_file` yImaS.

**rInpa' yIchov:** YAMLDaq `agent.verifyCommands` yISeH (chovnatlh: `bun test`) — vum veb taH chov yIvum; lujchugh Qagh Del lo' ghoqwI' poSqa'.

**Hooks:** Hoch jan tlhob ToolExecutorDaq PreToolUse / PostToolUse vegh (Hoch, Claude neH 'oHbe').

### nej 'ej wuv

| jan | meq |
|-----|-----|
| `list_search_sources` | Halmey yItetlhlu' (pong, version, edition, qorDu', Hemey, Dotlh) — vIt chu'pa' |
| `get_search_context` | ja'chuqvamvaD nuq Hal Qanlu' 'e' yI'ang |
| `set_search_context` | Halmey yIQan pagh yIteq (`sourceIds`, `labels`, `version`, `edition`, pagh `clear: true`) |
| `search_indexed` | FTS + vector tay' nej **Hal pongmey** je; ja'chuq/Qu' Qan yIHo'; DuH `sourceIds` / `labels` / `version` / `edition` |

law' **odoo qorDu'** Hal rIn 'ej Qan pagh 'ej janmey **`needsPin`** nob, versionmey mojbe'. yIlegh [nej — law' version Qan](/docs/tlh/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

### qawHaq moQmey

| jan | meq |
|-----|-----|
| `memory_block_read` / `memory_block_write` | lo'chuq Letta rur moQmey (malja' / ghoqwI' / ghom / vum) |

yIlegh [qawHaq](/docs/tlh/knowledge/memory/).

### leghwI'

| jan | meq |
|-----|-----|
| leghwI' ja'chuq janmey | yIjaH 'ej yIta'; **SSRF** nIH / De' jabbI'ID bot |
| `browser_snapshot` | accessibility-tree qaw (token nISbe') |

### QIn (qeq → laj → ngeH)

| jan | meq |
|-----|-----|
| `email_create_draft` | nIH qeq yIchu' |
| `email_approve_draft` | qeq laj 'e' yImaS |
| `email_send_draft` | lajchugh **neH** yIngeH |

### Odoo (DuH pat)

**yIn pat** (JSON-RPC):

| jan | meq |
|-----|-----|
| `odoo_search_tasks` | chaw'/Qu' nej (laD law') |
| `odoo_get_task` | wa' Qu' yISuq |
| `odoo_message_post` | ja'chuq QIn yIngeH |
| `odoo_write_task` | lojmIt ghItlh |

**nIH Hal tetlh** (ngoq tlhegh):

| jan | meq |
|-----|-----|
| `odoo_search_model` | nIH PythonDaq `_name` / `_inherit` yInej |
| `odoo_search_field` | `fields.*` nobmey yInej |
| `odoo_search_xml_id` | XML qaw IDmey yInej |

'o'mey Hal: ja'chuq/Qu' **Qan** → nej Halmey (`family: odoo`) → `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. DuH jan wIv: `label`, `labels`, `sourceIds`, `version`, `edition`. Hal pongmey: `[source:odoo-src:label:file:line]`.

laH: `coding/odoo/odoo-dev-chain`. yIn pegh mu'mey [ra'chuqmey](/docs/tlh/admin/connections/) (Odoo Segh). law' version nav: [nej](/docs/tlh/daily/search/) · [Qu'mey](/docs/tlh/daily/projects/) · ja'chuq **Halmey** nav.

### ra'chuq tetlh

| jan | meq |
|-----|-----|
| `connections_list` / `connections_catalog` | tetlh + tetlh tIn |
| `connections_test` | pIv chov |
| `connections_propose` | nuv lajvaD ra'chuq yIchup |

### CLI MCP rap

ghoqwI'pu' **Grok CLI** pagh **Kimi Code CLI**Daq vumchugh, EYAS stdio MCP tlham chel — jabbI'IDvey ToolExecutor janmey rap, pat qoD / Claude Code ja'chuq rur. yIlegh [MCP](/docs/tlh/ai/mcp/).

---

## latlh

- [ghoqwI'pu' — janmey yISeH](/docs/tlh/agents/configure/)
- [Hub lojmIt](/docs/tlh/admin/security-privacy/)
- [ra'chuqmey](/docs/tlh/admin/connections/)
