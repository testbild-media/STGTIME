import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { listStreamDecks } from '@elgato-stream-deck/node'

const workerPath = fileURLToPath(new URL('./device-worker.mjs', import.meta.url))
const workers = new Map()
const retryAfter = new Map()
let discovering = false

function startWorker(info) {
  const child = fork(workerPath, [JSON.stringify(info)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  workers.set(info.path, child)
  child.on('exit', (code, signal) => {
    workers.delete(info.path)
    retryAfter.set(info.path, Date.now() + 5000)
    console.error(`${info.model || 'Stream Deck'} worker exited (${signal || code}); retrying independently`)
  })
}

async function discover() {
  if (discovering) return
  discovering = true
  try {
    const found = await listStreamDecks()
    const paths = new Set(found.map(info => info.path))
    for (const [path, child] of workers) if (!paths.has(path)) child.kill('SIGTERM')
    for (const info of found) {
      if (!workers.has(info.path) && Date.now() >= (retryAfter.get(info.path) || 0)) startWorker(info)
    }
  } catch (error) { console.error(`Stream Deck discovery failed: ${error.message}`) }
  finally { discovering = false }
}

await discover()
setInterval(discover, 5000)
