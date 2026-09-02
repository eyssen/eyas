import { defineCommand } from 'citty'
import { platform, arch } from 'process'
import { getVersionInfo } from '@core/version.js'

export default defineCommand({
  meta: {
    name: 'version',
    description: 'Show EYAS version information',
  },
  run() {
    const info = getVersionInfo()
    const runtime = typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node.js ${process.version}`

    console.log(`\n${info.name} v${info.version} — ${info.codename}`)
    console.log(`Released: ${info.releaseDate}`)
    console.log(`Runtime:  ${runtime}`)
    console.log(`Platform: ${platform} ${arch}\n`)
  },
})
