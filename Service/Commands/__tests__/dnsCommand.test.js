import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import DnsCommand, { parseDnsServers, isSafeDomain } from '../DnsCommand.js'
import { fixture, fixturePath } from './fixtures.js'

const dns = new DnsCommand()

test('parses status and query time of an answer', () => {
    assert.deepEqual(dns.parseOutput(fixture('dig-ok.txt')), { status: 'NOERROR', queryTime: 0 })
})

test('parses a never-seen name, which has no answer records', () => {
    assert.deepEqual(dns.parseOutput(fixture('dig-random-name.txt')), { status: 'NOERROR', queryTime: 14 })
})

test('parses a resolver failure, which dig reports with exit code 0', () => {
    assert.deepEqual(dns.parseOutput(fixture('dig-servfail.txt')), { status: 'SERVFAIL', queryTime: 18 })
})

test('returns nulls when no server replied', () => {
    assert.deepEqual(dns.parseOutput(fixture('dig-timeout.txt')), { status: null, queryTime: null })
})

test('reads named resolvers from DNS_SERVERS and skips unsafe entries', () => {
    assert.deepEqual(parseDnsServers('local=10.0.0.53, public = 1.1.1.1'), [
        { resolver: 'local', server: '10.0.0.53' },
        { resolver: 'public', server: '1.1.1.1' },
    ])
    assert.deepEqual(parseDnsServers('evil=1.1.1.1;rm -rf /,Bad Name=1.1.1.1,=1.1.1.1,nohost='), [])
    assert.deepEqual(parseDnsServers(''), [])
    assert.deepEqual(parseDnsServers(undefined), [])
})

test('accepts only plain domain names for the query names', () => {
    assert.equal(isSafeDomain('example.org'), true)
    assert.equal(isSafeDomain('test.my-lab.home'), true)
    assert.equal(isSafeDomain('localhost'), false)
    assert.equal(isSafeDomain('example.com; rm -rf /'), false)
    assert.equal(isSafeDomain(undefined), false)
})

test('builds queries from the configured names, falling back to the defaults', () => {
    assert.equal(dns.buildCommand({ server: '1.1.1.1', query: 'cached' }), 'dig @1.1.1.1 google.com +tries=1 +time=2')
    assert.equal(dns.buildCommand({ query: 'cached', cachedName: 'wp.pl' }), 'dig wp.pl +tries=1 +time=2')
    assert.equal(dns.buildCommand({ query: 'cached', cachedName: 'bad name;' }), 'dig google.com +tries=1 +time=2')
    assert.match(dns.buildCommand({ server: '1.1.1.1', query: 'uncached' }),
        /^dig @1\.1\.1\.1 smarthome-[0-9a-f]{12}\.example\.com \+tries=1 \+time=2$/)
    assert.match(dns.buildCommand({ query: 'uncached', uncachedDomain: 'example.org' }),
        /^dig smarthome-[0-9a-f]{12}\.example\.org \+tries=1 \+time=2$/)
    assert.notEqual(dns.buildCommand({ query: 'uncached' }), dns.buildCommand({ query: 'uncached' }))
})

// execute() against a fake `dig` on PATH: no network, but the real exec/parse/metric path.
let binDir
let originalPath

const fakeDig = (script) => {
    const file = join(binDir, 'dig')
    writeFileSync(file, `#!/bin/sh\necho "$@" > "${join(binDir, 'args')}"\n${script}\n`)
    chmodSync(file, 0o755)
}

before(() => {
    binDir = mkdtempSync(join(tmpdir(), 'fake-dig-'))
    originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath}`
})

after(() => {
    process.env.PATH = originalPath
    rmSync(binDir, { recursive: true, force: true })
})

test('execute resolves with a dns metric for an answer', async () => {
    fakeDig(`cat "${fixturePath('dig-random-name.txt')}"`)

    const result = await dns.execute({ resolver: 'local', server: '192.0.2.53', query: 'uncached', computerTag: 'pi9' })

    assert.deepEqual(result, {
        metricName: 'dns',
        metrics: { queryTime: 14 },
        tags: { resolver: 'local', query: 'uncached', computerTag: 'pi9' },
    })
    assert.match(readFileSync(join(binDir, 'args'), 'utf8'), /^@192\.0\.2\.53 smarthome-/)
})

test('execute resolves with a dnsError metric for SERVFAIL, although dig exits 0', async () => {
    fakeDig(`cat "${fixturePath('dig-servfail.txt')}"`)

    const result = await dns.execute({ resolver: 'public', server: '1.1.1.1', query: 'cached', computerTag: 'pi9' })

    assert.deepEqual(result, {
        metricName: 'dnsError',
        metrics: { count: '1' },
        tags: { resolver: 'public', query: 'cached', computerTag: 'pi9', error: 'servfail' },
    })
})

test('execute resolves with a dnsError metric when no server replies (dig exit 9)', async () => {
    fakeDig(`cat "${fixturePath('dig-timeout.txt')}"\nexit 9`)

    const result = await dns.execute({ resolver: 'local', server: '192.0.2.53', computerTag: 'pi9' })

    assert.deepEqual(result, {
        metricName: 'dnsError',
        metrics: { count: '1' },
        tags: { resolver: 'local', query: 'cached', computerTag: 'pi9', error: 'no reply' },
    })
})
