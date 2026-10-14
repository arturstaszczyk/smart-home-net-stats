import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import SpeedTestCommand from '../SpeedTestCommand.js'
import { fixture, fixturePath } from './fixtures.js'

const speedTest = new SpeedTestCommand()
const okResult = () => JSON.parse(fixture('speedtest-ok.json'))

test('converts Ookla bandwidth from bytes/s to Mbit/s and keeps the other measurements', () => {
    assert.deepEqual(speedTest.parseOutput(fixture('speedtest-ok.json')), {
        download: 882.822232,
        upload: 100.994848,
        ping: 5.112,
        jitter: 0.401,
        packetLoss: 0,
        downloadLatency: 5.607,
        uploadLatency: 4.852,
        serverId: 38577,
    })
})

test('omits values the server did not report', () => {
    const result = okResult()
    delete result.packetLoss
    delete result.upload

    const stats = speedTest.parseOutput(JSON.stringify(result))

    assert.equal('packetLoss' in stats, false)
    assert.equal('upload' in stats, false)
    assert.equal('uploadLatency' in stats, false)
    assert.equal(stats.download, 882.822232)
})

test('returns no fields for output that is not JSON', () => {
    assert.deepEqual(speedTest.parseOutput('Ping: 12.236 ms\nDownload: 675.51 Mbit/s\n'), {})
})

test('returns no fields for an Ookla log line instead of a result', () => {
    const log = '{"type":"log","message":"Configuration - No servers defined (NoServersException)","level":"error"}'

    assert.deepEqual(speedTest.parseOutput(log), {})
})

test('builds the command with a pinned server only when the id is numeric', () => {
    const base = 'speedtest --accept-license --accept-gdpr --format=json --progress=no'

    assert.equal(speedTest.buildCommand({}), base)
    assert.equal(speedTest.buildCommand({ serverId: '' }), base)
    assert.equal(speedTest.buildCommand({ serverId: '38577' }), `${base} --server-id=38577`)
    assert.equal(speedTest.buildCommand({ serverId: 38577 }), `${base} --server-id=38577`)
    assert.equal(speedTest.buildCommand({ serverId: '1; rm -rf /' }), base)
})

// execute() against a fake `speedtest` on PATH: no network, but the real exec/parse/metric path.
let binDir
let originalPath

const fakeSpeedtest = (script) => {
    const file = join(binDir, 'speedtest')
    writeFileSync(file, `#!/bin/sh\necho "$@" > "${join(binDir, 'args')}"\n${script}\n`)
    chmodSync(file, 0o755)
}

before(() => {
    binDir = mkdtempSync(join(tmpdir(), 'fake-speedtest-'))
    originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath}`
})

after(() => {
    process.env.PATH = originalPath
    rmSync(binDir, { recursive: true, force: true })
})

test('execute resolves with a speedtest metric for a successful run', async () => {
    fakeSpeedtest(`cat "${fixturePath('speedtest-ok.json')}"`)

    const result = await speedTest.execute({ computerTag: 'pi9', serverId: '38577' })

    assert.equal(result.metricName, 'speedtest')
    assert.deepEqual(result.tags, { computerTag: 'pi9' })
    assert.equal(result.metrics.download, 882.822232)
    assert.match(readFileSync(join(binDir, 'args'), 'utf8'), /--format=json .*--server-id=38577/)
})

test('execute resolves with a speedtest-error metric when Ookla fails', async () => {
    // What Ookla really does for an unknown server: JSON log on stderr, exit code 2.
    fakeSpeedtest('echo \'{"type":"log","message":"No servers defined","level":"error"}\' >&2\nexit 2')

    const result = await speedTest.execute({ computerTag: 'pi9' })

    assert.deepEqual(result, {
        metricName: 'speedtest-error',
        metrics: { count: '1' },
        tags: { computerTag: 'pi9', error: 'error' },
    })
})
