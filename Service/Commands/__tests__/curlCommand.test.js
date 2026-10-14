import { test } from 'node:test'
import assert from 'node:assert/strict'
import CurlCommand from '../CurlCommand.js'
import { fixture } from './fixtures.js'

const curl = new CurlCommand()

test('parses all cumulative timings of an HTTPS request', () => {
    assert.deepEqual(curl.parseOutput(fixture('curl-https.txt')), {
        namelookup: '0.007922',
        connect: '0.020321',
        appconnect: '0.061638',
        pretransfer: '0.061840',
        starttransfer: '0.119171',
        total: '0.135471',
    })
})

test('reports appconnect 0 for plain HTTP, so phases must be split at pretransfer', () => {
    const timings = curl.parseOutput(fixture('curl-http.txt'))

    assert.equal(timings.appconnect, '0.000000')
    assert.ok(Number(timings.pretransfer) >= Number(timings.connect))
})

test('normalises comma decimals', () => {
    const output = fixture('curl-https.txt').replace(/(\d)\.(\d)/g, '$1,$2')

    assert.deepEqual(curl.parseOutput(output), curl.parseOutput(fixture('curl-https.txt')))
})

test('omits timings it cannot find', { todo: 'returns null fields today (plan, Phase 3 #5)' }, () => {
    assert.deepEqual(curl.parseOutput('curl: (6) Could not resolve host'), {})
})
