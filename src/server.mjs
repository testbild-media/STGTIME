import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from './core/config-store.mjs'
import { TimerEngine } from './core/timer.mjs'
import { AuthManager } from './auth.mjs'
import { renderDisplay } from './display/renderer.mjs'
import { decodePng } from './display/framebuffer.mjs'
import { DisplayOutput } from './display/output.mjs'
import { NetworkService } from './network/service.mjs'
import { SystemService } from './system/service.mjs'
import { UpdateService } from './update/service.mjs'
import { createHandler } from './application.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()
const store = new ConfigStore({ defaultsPath: join(root, 'config/default.json'), dataPath: process.env.STGTIME_CONFIG || join(root, 'data/config.json') })
let settings = await store.load()
if (process.env.STGTIME_DISPLAY_DRIVER) settings.display.driver = process.env.STGTIME_DISPLAY_DRIVER
const timer = new TimerEngine(settings.timer)
const network = new NetworkService()
const system = new SystemService()
const updates = new UpdateService({ version })
const auth = new AuthManager({ getSecurity: () => store.get().security })
const output = new DisplayOutput(settings.display); output.start()
const startedAt = Date.now()
const splash = decodePng(readFileSync(join(root, 'assets/splash.png')))
let frame = splash

const context = {
  timer, store, auth, network, system, updates, version,
  webRoot: join(root, 'web'),
  logoPath: join(root, 'web/assets/logo.svg'),
  getFrame: () => frame,
  state: () => ({ timer: timer.status(), display: output.status(), message: settings.message, video: settings.video, system: { version, uptimeMs: Date.now() - startedAt, addresses: network.addresses() } }),
  settingsChanged: next => {
    settings = next
    timer.configure({ continueNegative: settings.timer.continueNegative })
    const displaySettings = { ...settings.display, ...(process.env.STGTIME_DISPLAY_DRIVER ? { driver: process.env.STGTIME_DISPLAY_DRIVER } : {}) }
    output.reconfigure(displaySettings)
  }
}

setInterval(() => {
  timer.sync()
  const age = Date.now() - startedAt
  const bootMessage = age >= 1500 && age < 11_500 ? network.primaryAddress() : null
  frame = age < 1500 ? splash : renderDisplay({ timer: timer.status(), bootMessage }, settings, new Date())
  output.write(frame)
}, 100).unref()

const port = Number(process.env.PORT || 8080)
const server = createServer(createHandler(context))
server.listen(port, '0.0.0.0', () => console.log(`STGTIME listening on http://0.0.0.0:${port}`))

setTimeout(() => updates.check().catch(error => console.error(`Update check failed: ${error.message}`)), 30_000).unref()
setInterval(() => updates.check().catch(error => console.error(`Update check failed: ${error.message}`)), 24 * 60 * 60_000).unref()

system.setTimeZone(settings.display.timeZone).catch(error => console.error(`System time-zone sync failed: ${error.message}`))

if (settings.network.hotspotMode === 'always' || settings.network.hotspotMode === 'startup-5m') {
  network.apply('hotspot-on', settings.network).catch(error => console.error(`Hotspot startup failed: ${error.message}`))
  if (settings.network.hotspotMode === 'startup-5m') setTimeout(() => {
    if (store.get().network.hotspotMode === 'startup-5m') network.apply('hotspot-off', store.get().network).catch(error => console.error(`Hotspot shutdown failed: ${error.message}`))
  }, 5 * 60_000).unref()
}

function shutdown() { output.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 3000).unref() }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
