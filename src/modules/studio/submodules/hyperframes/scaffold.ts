// Part of eYssen. See LICENSE file for full copyright and licensing details.

export function scaffoldComposition(title: string): string {
  const safe = title.replace(/[<>&]/g, '') || 'Untitled'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${safe}</title>
  <style>
    html, body { margin: 0; background: #0b0b0f; color: #f4f4f5; font-family: ui-sans-serif, system-ui, sans-serif; }
    #stage { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
    #title { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 96px; margin: 0; letter-spacing: -0.04em; }
  </style>
</head>
<body>
  <div id="stage" data-composition-id="main" data-start="0" data-duration="5" data-width="1920" data-height="1080">
    <h1 id="title" class="clip" data-start="0" data-duration="5" data-track-index="0">${safe}</h1>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: 40, duration: 0.8 }, 0);
    window.__timelines = window.__timelines || {};
    window.__timelines.main = tl;
  </script>
</body>
</html>
`
}

export interface StructuralFinding {
  level: 'error' | 'warning'
  message: string
}

export function structuralLint(html: string): StructuralFinding[] {
  const findings: StructuralFinding[] = []
  if (!/data-composition-id\s*=/.test(html)) {
    findings.push({ level: 'error', message: 'Missing data-composition-id on the stage' })
  }
  if (!/class\s*=\s*["'][^"']*\bclip\b/.test(html)) {
    findings.push({ level: 'error', message: 'No element with class="clip"' })
  }
  if (!/data-start\s*=/.test(html) || !/data-duration\s*=/.test(html)) {
    findings.push({ level: 'error', message: 'Missing data-start or data-duration' })
  }
  if (/gsap\.timeline\s*\(/.test(html) && !/paused\s*:\s*true/.test(html)) {
    findings.push({ level: 'error', message: 'GSAP timeline must be created with { paused: true }' })
  }
  if (/gsap\.timeline\s*\(/.test(html) && !/window\.__timelines/.test(html)) {
    findings.push({ level: 'warning', message: 'GSAP timeline is not registered on window.__timelines' })
  }
  return findings
}
