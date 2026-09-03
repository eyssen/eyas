// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ExtensionPack } from './types.js'

/**
 * Built-in extension registry.
 * These packs are NOT bundled with EYAS — they are downloaded on-demand
 * with explicit user consent for non-MIT-compatible licenses.
 *
 * Future: this could be fetched from a remote registry URL.
 */
export const extensionRegistry: ExtensionPack[] = [
  // ── Auto-installable packs (EYAS downloads for you) ──────────────
  {
    id: 'example-skills',
    name: 'Example Skills Pack',
    description: 'Example knowledge skills demonstrating how EYAS extension packs bundle domain-specific development knowledge — models, views, components, security, testing, performance, and more.',
    version: '1.0.0',
    author: 'eYssen',
    license: 'LGPL-3.0',
    licenseCompat: 'copyleft',
    licenseNotice:
      'This skill pack contains code examples that demonstrate a third-party framework\'s usage patterns. ' +
      'The underlying framework is licensed under LGPL-3.0. By installing this pack, you acknowledge that:\n' +
      '• The code examples reference framework APIs which are LGPL-3.0 licensed\n' +
      '• You must independently comply with LGPL-3.0 terms when using that framework\n' +
      '• These skills are instructional content, not the framework\'s source code\n' +
      '• EYAS itself remains MIT licensed and is not affected by this extension',
    installType: 'auto',
    downloadUrl: 'https://github.com/eyssen/eyas-extensions/releases/download/v1.0.0/example-skills.tar.gz',
    skillCount: 15,
    categories: ['example'],
    minEyasVersion: '0.8.0',
    icon: '🦊',
    tags: ['example', 'skills', 'demo', 'lgpl'],
  },

  {
    id: 'pandoc',
    name: 'Pandoc Document Converter',
    description: 'Universal document converter — Markdown, DOCX, PDF, HTML, LaTeX, EPUB and 40+ formats.',
    version: '3.6.0',
    author: 'John MacFarlane',
    license: 'GPL-2.0',
    licenseCompat: 'copyleft',
    licenseNotice:
      'Pandoc is licensed under GPL-2.0. By installing, you acknowledge that:\n' +
      '• Pandoc runs as a separate process — it is NOT linked into EYAS\n' +
      '• EYAS communicates with Pandoc via CLI (stdin/stdout), not library calls\n' +
      '• EYAS itself remains MIT licensed and is not affected\n' +
      '• You may use Pandoc freely for document conversion',
    installType: 'auto',
    downloadUrl: 'https://github.com/jgm/pandoc/releases',
    skillCount: 0,
    categories: ['documents', 'conversion'],
    minEyasVersion: '0.8.0',
    icon: '📄',
    tags: ['pandoc', 'markdown', 'docx', 'pdf', 'html', 'latex', 'epub', 'document-conversion'],
  },
  {
    id: 'clamav',
    name: 'ClamAV Antivirus',
    description: 'Open-source antivirus engine — scan uploaded files for malware before processing.',
    version: '1.4.0',
    author: 'Cisco Talos',
    license: 'GPL-2.0',
    licenseCompat: 'copyleft',
    licenseNotice:
      'ClamAV is licensed under GPL-2.0. By installing, you acknowledge that:\n' +
      '• ClamAV runs as a separate daemon (clamd) — NOT linked into EYAS\n' +
      '• EYAS communicates via Unix socket, not library calls\n' +
      '• EYAS itself remains MIT licensed and is not affected\n' +
      '• Virus definitions are updated separately via freshclam',
    installType: 'auto',
    downloadUrl: 'https://github.com/Cisco-Talos/clamav/releases',
    skillCount: 0,
    categories: ['security', 'antivirus'],
    minEyasVersion: '0.8.0',
    icon: '🛡️',
    tags: ['clamav', 'antivirus', 'malware', 'security', 'file-scanning'],
  },
  {
    id: 'semgrep',
    name: 'Semgrep Static Analysis',
    description: 'Lightweight static analysis — find bugs, security vulnerabilities, and enforce code standards with pattern matching.',
    version: '1.100.0',
    author: 'Semgrep Inc.',
    license: 'LGPL-2.1',
    licenseCompat: 'copyleft',
    licenseNotice:
      'Semgrep Community Edition is LGPL-2.1 licensed. By installing, you acknowledge that:\n' +
      '• Semgrep runs as a separate CLI process — NOT linked into EYAS\n' +
      '• EYAS communicates via JSON output, not library calls\n' +
      '• Custom rules you write are yours — Semgrep\'s bundled rules have a separate license\n' +
      '• Consider Opengrep (github.com/opengrep/opengrep) as an alternative fork',
    installType: 'auto',
    downloadUrl: 'https://github.com/semgrep/semgrep/releases',
    skillCount: 0,
    categories: ['code-analysis', 'security'],
    minEyasVersion: '0.8.0',
    icon: '🔍',
    tags: ['semgrep', 'static-analysis', 'security', 'code-quality', 'sast'],
  },
  {
    id: 'libreoffice',
    name: 'LibreOffice Headless',
    description: 'Office document processing — convert DOCX, XLSX, PPTX to PDF and other formats via headless mode.',
    version: '24.8.0',
    author: 'The Document Foundation',
    license: 'LGPL-3.0',
    licenseCompat: 'copyleft',
    licenseNotice:
      'LibreOffice is licensed under LGPL-3.0 / MPL-2.0. By installing, you acknowledge that:\n' +
      '• LibreOffice runs as a separate headless process — NOT linked into EYAS\n' +
      '• EYAS communicates via CLI commands (soffice --convert-to)\n' +
      '• EYAS itself remains MIT licensed and is not affected\n' +
      '• LibreOffice is a large installation (~500MB+)',
    installType: 'auto',
    downloadUrl: 'https://www.libreoffice.org/download/download/',
    skillCount: 0,
    categories: ['documents', 'conversion'],
    minEyasVersion: '0.8.0',
    icon: '📊',
    tags: ['libreoffice', 'docx', 'xlsx', 'pptx', 'pdf', 'office', 'conversion'],
  },

  // ── Manual-install third-party tools (user downloads independently) ──
  {
    id: 'drawbridge',
    name: 'Drawbridge',
    description: 'Browser-based visual annotation tool — place Figma-like comments on any webpage and pipe them to AI code editors.',
    version: '1.0.5',
    author: 'breschio',
    license: 'Proprietary',
    licenseCompat: 'proprietary',
    licenseNotice:
      'Drawbridge uses a proprietary license. Key restrictions:\n' +
      '• Free to use and modify for lawful purposes\n' +
      '• NO redistribution, sublicensing, or selling\n' +
      '• Cannot be offered as a commercial service\n' +
      '• EYAS does not distribute Drawbridge — you must download it yourself\n\n' +
      'Full license: https://github.com/breschio/drawbridge/blob/main/LICENSE',
    installType: 'manual',
    downloadUrl: 'https://github.com/breschio/drawbridge',
    skillCount: 0,
    categories: ['browser', 'design', 'annotation'],
    icon: '🎨',
    tags: ['browser', 'design', 'annotation', 'chrome-extension', 'visual-feedback'],
    setupGuide:
      '## Setup Drawbridge with EYAS\n\n' +
      '### 1. Install Drawbridge\n' +
      '```bash\n' +
      'git clone https://github.com/breschio/drawbridge.git\n' +
      'cd drawbridge && npm install\n' +
      '```\n\n' +
      '### 2. Load the Chrome Extension\n' +
      '1. Open `chrome://extensions`\n' +
      '2. Enable "Developer mode"\n' +
      '3. Click "Load unpacked" → select the drawbridge directory\n\n' +
      '### 3. Connect to EYAS\n' +
      'Configure Drawbridge to send annotations to your EYAS instance:\n' +
      '- Set the webhook URL to `http://localhost:3100/api/v1/ingress/webhook`\n' +
      '- EYAS will receive annotations as structured messages in your conversations\n\n' +
      '### How it works\n' +
      'Drawbridge lets you place visual comments directly on webpages (similar to Figma comments). ' +
      'When connected to EYAS, these annotations are sent as context-rich messages that your AI agents ' +
      'can use to understand UI issues, design feedback, or bug reports with visual context.',
  },
  {
    id: 'grafana',
    name: 'Grafana Dashboard',
    description: 'Monitoring and observability dashboard — visualize metrics, logs, and traces from EYAS and connected services.',
    version: '11.4.0',
    author: 'Grafana Labs',
    license: 'AGPL-3.0',
    licenseCompat: 'copyleft',
    licenseNotice:
      'Grafana is licensed under AGPL-3.0. Key points:\n' +
      '• Grafana must be self-hosted as a separate service\n' +
      '• EYAS connects to Grafana via HTTP API — no code linking\n' +
      '• If you modify Grafana source code, you must share your changes\n' +
      '• Using Grafana as-is for internal monitoring is fine\n' +
      '• EYAS does not distribute Grafana — download it from grafana.com',
    installType: 'manual',
    downloadUrl: 'https://github.com/grafana/grafana',
    skillCount: 0,
    categories: ['monitoring', 'observability', 'dashboard'],
    icon: '📈',
    tags: ['grafana', 'monitoring', 'dashboard', 'metrics', 'observability'],
    setupGuide:
      '## Setup Grafana with EYAS\n\n' +
      '### 1. Install Grafana\n' +
      '```bash\n' +
      '# macOS\n' +
      'brew install grafana\n' +
      '# Or Docker\n' +
      'docker run -d -p 3001:3000 grafana/grafana-oss\n' +
      '```\n\n' +
      '### 2. Configure EYAS data source\n' +
      'In Grafana, add a Prometheus data source pointing to EYAS metrics:\n' +
      '- URL: `http://localhost:3100/api/v1/observability/metrics`\n' +
      '- Scrape interval: 15s\n\n' +
      '### 3. Import EYAS dashboard\n' +
      'EYAS provides a pre-built dashboard JSON at `config/grafana/eyas-dashboard.json`.',
  },
  {
    id: 'stable-diffusion-webui',
    name: 'Stable Diffusion WebUI',
    description: 'AI image generation — generate images from text prompts, accessible as an EYAS agent tool.',
    version: '1.10.0',
    author: 'AUTOMATIC1111',
    license: 'AGPL-3.0',
    licenseCompat: 'copyleft',
    licenseNotice:
      'Stable Diffusion WebUI is licensed under AGPL-3.0. Key points:\n' +
      '• Must be self-hosted as a separate service with its own API\n' +
      '• EYAS connects via HTTP API — no code linking\n' +
      '• Requires a GPU (NVIDIA recommended, 8GB+ VRAM)\n' +
      '• Model weights have separate licenses (check each model)\n' +
      '• EYAS does not distribute this software — download from GitHub',
    installType: 'manual',
    downloadUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
    skillCount: 0,
    categories: ['ai', 'image-generation'],
    icon: '🎨',
    tags: ['stable-diffusion', 'image-generation', 'ai-art', 'gpu'],
    setupGuide:
      '## Setup Stable Diffusion with EYAS\n\n' +
      '### 1. Install\n' +
      '```bash\n' +
      'git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui.git\n' +
      'cd stable-diffusion-webui\n' +
      './webui.sh --api  # Start with API enabled\n' +
      '```\n\n' +
      '### 2. Connect to EYAS\n' +
      'Configure the SD API endpoint in EYAS Settings > Integrations:\n' +
      '- API URL: `http://localhost:7860`\n' +
      '- EYAS agents can then use the `generate-image` tool',
  },
  {
    id: 'recordly',
    name: 'Recordly',
    description:
      'Desktop screen recorder and demo editor (zooms, cursor polish, webcam bubble, styled frames). Separate AGPL app — EYAS does not ship or link it. Export MP4/GIF, then attach in Documents.',
    version: '1.3.3',
    author: 'webadderall',
    license: 'AGPL-3.0',
    licenseCompat: 'copyleft',
    licenseNotice:
      'Recordly is licensed under AGPL-3.0, with extra upstream terms in LICENSE.md. Key points:\n' +
      '• Recordly is a separate desktop app — EYAS does NOT download, vendor, link, or wrap its source\n' +
      '• There is no Recordly CLI and no recordly_* agent tool; you record and export in Recordly itself\n' +
      '• If you modify Recordly, AGPL source-offer applies to Recordly (not to EYAS)\n' +
      '• Do not use the Recordly name or branding as an EYAS product name; this card is a nominative reference to the upstream app\n' +
      '• Derived Recordly code would require UI + repo attribution; EYAS ships none\n' +
      '• EYAS itself remains MIT licensed\n\n' +
      'Full license: https://github.com/webadderallorg/Recordly/blob/main/LICENSE.md',
    installType: 'manual',
    downloadUrl: 'https://github.com/webadderallorg/Recordly',
    skillCount: 0,
    categories: ['video', 'screen-recording', 'demo'],
    icon: '🎬',
    tags: ['recordly', 'screen-recording', 'demo', 'walkthrough', 'cursor', 'agpl'],
    setupGuide:
      '## Setup Recordly with EYAS\n\n' +
      'Recordly is a **separate desktop app** (AGPL-3.0). EYAS will not install it, launch it, or automate it. There is no CLI.\n\n' +
      '### 1. Install Recordly yourself\n' +
      'Prebuilt releases: https://github.com/webadderallorg/Recordly/releases\n\n' +
      'Requirements: macOS 14.0+, Windows 10 Build 19041+, or a modern Linux distro.\n\n' +
      'Arch / Manjaro: `yay -S recordly-bin`\n\n' +
      'From source:\n' +
      '```bash\n' +
      'git clone https://github.com/webadderallorg/Recordly.git recordly\n' +
      'cd recordly && npm install && npm run build\n' +
      '```\n\n' +
      '### 2. Record and export in Recordly\n' +
      '1. Launch Recordly (not EYAS).\n' +
      '2. Record a display or window; edit zooms, cursor, webcam, and frame there.\n' +
      '3. Export **MP4** or **GIF**. `.recordly` project files stay in Recordly.\n\n' +
      '### 3. Bring the file into EYAS\n' +
      'Attach the export in a conversation or add it to Documents. To cut further, use Studio Video Use (`videouse_*`). Hyperframes is HTML→MP4, not screen capture. Media is hosted prompt→pixels.\n\n' +
      '### What EYAS does not do\n' +
      '- Does not vendor or copy Recordly source\n' +
      '- Does not auto-install this pack (GitHub / Setup guide only)\n' +
      '- Does not brand EYAS features as Recordly',
  },
]

/** Classify a license as MIT-compatible, copyleft, or proprietary */
export function classifyLicense(license: string): 'mit-compatible' | 'copyleft' | 'proprietary' | 'unknown' {
  const mitCompatible = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Unlicense', 'MIT-0', 'CC0-1.0', '0BSD']
  const copyleft = ['GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0', 'CC-BY-SA-4.0', 'EUPL-1.2']

  const normalized = license.replace(/-only$|-or-later$/, '')
  if (mitCompatible.includes(normalized)) return 'mit-compatible'
  if (copyleft.includes(normalized)) return 'copyleft'
  if (license.toLowerCase().includes('proprietary') || license.toLowerCase().includes('commercial')) return 'proprietary'
  return 'unknown'
}
