import { test } from 'node:test'
import assert from 'node:assert/strict'
import DataUsedCommand from '../DataUsedCommand.js'
import { fixture } from './fixtures.js'

const dataUsed = new DataUsedCommand()

test('parses byte counters and the difference to the previous reading', () => {
    const stats = dataUsed.parseOutput(fixture('ifconfig-lo.txt'), {
        oldDownloadBytes: 313600000,
        oldUploadBytes: 313000000,
    })

    assert.deepEqual(stats, {
        downloadBytes: '313613676',
        uploadBytes: '313613676',
        diffDownloaded: 13676,
        diffUploaded: 613676,
    })
})

test('treats a missing previous reading as 0', () => {
    const stats = dataUsed.parseOutput(fixture('ifconfig-lo.txt'), {})

    assert.equal(stats.diffDownloaded, 313613676)
})

test('does not throw on output it does not recognise', { todo: 'throws a TypeError today (plan, Phase 3 #1)' }, () => {
    assert.doesNotThrow(() => dataUsed.parseOutput('wlan0: error fetching interface information: Device not found', {}))
})
