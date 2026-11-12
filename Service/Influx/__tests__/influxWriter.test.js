import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'

import InfluxWriter, { configFromEnv, writeResults } from '../influxWriter.js'

const config = {
    host: 'localhost', port: '8086', db: 'smart-home-db', retention: 'autogen', user: 'u', pass: 'p',
}

// Records what InfluxWriter does with the client's WriteApi.
const stubWriteApi = ({ flushError } = {}) => ({
    points: [],
    flushes: 0,
    closes: 0,
    writePoint(point) {
        this.points.push(point)
    },
    flush() {
        this.flushes++
        return flushError ? Promise.reject(flushError) : Promise.resolve()
    },
    close() {
        this.closes++
        return Promise.resolve()
    },
})

const makeWriter = (writeApi) => new InfluxWriter(config, { writeApi, queryApi: {} })

// Points are logged and sent as line protocol; a fixed timestamp keeps the lines comparable.
const lines = (writeApi) => writeApi.points.map((point) => point.timestamp('1').toLineProtocol())

// Captures console output during fn, so expected error logs stay out of the test report.
const captureConsole = async (fn) => {
    const logged = []
    const saved = { log: console.log, warn: console.warn, error: console.error }
    for (const level of Object.keys(saved)) {
        console[level] = (...args) => logged.push(args.join(' '))
    }
    try {
        return { result: await fn(), logged }
    } finally {
        Object.assign(console, saved)
    }
}

test('configFromEnv reads the INFLUX_* variables', () => {
    assert.deepEqual(configFromEnv({
        INFLUX_HOST: 'h', INFLUX_PORT: '1', INFLUX_DB: 'd', INFLUX_RETENTION: 'r', INFLUX_USER: 'u', INFLUX_PASS: 'p',
    }), { host: 'h', port: '1', db: 'd', retention: 'r', user: 'u', pass: 'p' })
})

test('tags become Influx tags and metrics become float fields', async () => {
    const writeApi = stubWriteApi()
    await captureConsole(() => makeWriter(writeApi)
        .storeMetrics('ping', { address: 'google.com', computerTag: 'pi4' }, { avg: 12, loss: '0.5', max: 13.25 }))

    // `12` is written as a float (no `i` suffix), and the numeric string is parsed as before.
    assert.deepEqual(lines(writeApi), ['ping,address=google.com,computerTag=pi4 avg=12,loss=0.5,max=13.25 1'])
})

test('storeMetrics drops non-numeric fields and queues nothing without fields', async () => {
    const writeApi = stubWriteApi()
    const { result } = await captureConsole(() => {
        const writer = makeWriter(writeApi)
        return [
            writer.storeMetrics('curl', { address: 'x' }, { total: 1.5, connect: NaN, dns: 'n/a' }),
            writer.storeMetrics('curl', { address: 'x' }, {}),
            writer.storeMetrics('curl', { address: 'x' }, { total: null }),
        ]
    })

    assert.deepEqual(result, [true, false, false])
    assert.deepEqual(lines(writeApi), ['curl,address=x total=1.5 1'])
})

test('writeResults queues the whole batch, flushes once, then closes', async () => {
    const writeApi = stubWriteApi()
    const { result } = await captureConsole(() => writeResults(makeWriter(writeApi), [
        { metricName: 'ping', tags: { address: 'a' }, metrics: { avg: 1 } },
        { metricName: 'pingError', tags: { address: 'b', error: 'x' }, metrics: { count: 1 } },
        { metricName: 'curl', tags: { address: 'c' }, metrics: { total: 2 } },
    ]))

    assert.deepEqual(result, { queued: 3, skipped: 0, written: true })
    assert.equal(writeApi.points.length, 3)
    assert.equal(writeApi.flushes, 1)
    assert.equal(writeApi.closes, 1)
})

test('writeResults skips and logs results with no metricName or no fields', async () => {
    const writeApi = stubWriteApi()
    const { result, logged } = await captureConsole(() => writeResults(makeWriter(writeApi), [
        { metricName: 'ping', tags: { address: 'a' }, metrics: { avg: 1 } },
        new Error('not a metric'),
        undefined,
        { tags: { address: 'b' }, metrics: { avg: 1 } },
        { metricName: 'curl', tags: { address: 'c' }, metrics: {} },
        { metricName: 'curl', tags: { address: 'd' } },
    ]))

    assert.deepEqual(result, { queued: 1, skipped: 5, written: true })
    assert.deepEqual(lines(writeApi), ['ping,address=a avg=1 1'])
    assert.equal(logged.filter((line) => line.startsWith('Skipping result')).length, 5)
})

test('writeResults does not flush an empty batch but still closes', async () => {
    const writeApi = stubWriteApi()
    const { result } = await captureConsole(() => writeResults(makeWriter(writeApi), [{ metricName: 'curl', metrics: {} }]))

    assert.deepEqual(result, { queued: 0, skipped: 1, written: true })
    assert.equal(writeApi.flushes, 0)
    assert.equal(writeApi.closes, 1)
})

test('a rejected flush is logged with its status code and not thrown', async () => {
    const error = Object.assign(new Error('unauthorized access'), { statusCode: 401 })
    const writeApi = stubWriteApi({ flushError: error })
    const { result, logged } = await captureConsole(() => writeResults(makeWriter(writeApi), [
        { metricName: 'ping', tags: { address: 'a' }, metrics: { avg: 1 } },
    ]))

    assert.deepEqual(result, { queued: 1, skipped: 0, written: false })
    assert.equal(writeApi.closes, 1)
    assert.ok(logged.some((line) => line.includes('Influx write failed') && line.includes('HTTP 401 unauthorized access')))
})

// The real @influxdata/influxdb-client against a local server that answers like InfluxDB 1.8
// does to a wrong INFLUX_PASS.
test('with the real client, a 401 is logged and does not crash', async (t) => {
    const requests = []
    const server = http.createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
            requests.push({ url: req.url, auth: req.headers.authorization, body })
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end('{"error":"authorization failed"}')
        })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => server.close())

    const writerConfig = { ...config, host: '127.0.0.1', port: server.address().port, pass: 'wrong' }
    const { result, logged } = await captureConsole(() => writeResults(new InfluxWriter(writerConfig), [
        { metricName: 'ping', tags: { address: 'a', computerTag: 'pi4' }, metrics: { avg: 1.5 } },
        { metricName: 'dns', tags: { resolver: 'system' }, metrics: { queryTime: 3 } },
    ]))

    assert.deepEqual(result, { queued: 2, skipped: 0, written: false })
    assert.equal(requests.length, 1, 'one request for the whole batch')
    assert.match(requests[0].url, /^\/api\/v2\/write\?org=&bucket=smart-home-db%2Fautogen&precision=ns$/)
    assert.equal(requests[0].auth, 'Token u:wrong')
    assert.deepEqual(requests[0].body.split('\n').map((line) => line.replace(/ \d+$/, '')),
        ['ping,address=a,computerTag=pi4 avg=1.5', 'dns,resolver=system queryTime=3'])
    assert.ok(logged.some((line) => line.includes('Influx write failed') && line.includes('HTTP 401 Unauthorized')))
})

test('with the real client, an unreachable Influx is logged and does not crash', async () => {
    // Grab a free port, then close it so nothing listens there.
    const probe = net.createServer()
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const { port } = probe.address()
    await new Promise((resolve) => probe.close(resolve))

    const writerConfig = { ...config, host: '127.0.0.1', port }
    const { result, logged } = await captureConsole(() => writeResults(new InfluxWriter(writerConfig), [
        { metricName: 'ping', tags: { address: 'a' }, metrics: { avg: 1 } },
    ]))

    assert.deepEqual(result, { queued: 1, skipped: 0, written: false })
    assert.ok(logged.some((line) => line.includes('Influx write failed') && line.includes('ECONNREFUSED')))
})
