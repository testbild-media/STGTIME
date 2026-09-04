import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler } from '../src/application.mjs'

test('Web GUI files are never served from a stale browser cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stgtime-static-'))
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>STGTIME</title>')
  const context = {
    timer: {}, store: {}, auth: { authorized: () => false }, network: {}, getFrame: () => null,
    webRoot: directory, logoPath: '', state: () => ({}), settingsChanged: () => {}
  }
  const server = createServer(createHandler(context)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) }
})
