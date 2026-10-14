import { test } from 'node:test'
import assert from 'node:assert/strict'
import PingCommand from '../PingCommand.js'
import { fixture } from './fixtures.js'

const ping = new PingCommand()

test('parses packet counts and round-trip times from a successful ping', () => {
    assert.deepEqual(ping.parseOutput(fixture('ping-ok.txt')), {
        packetsSent: '6',
        packetsPercent: '0',
        min: '9.028',
        avg: '10.783',
        max: '14.007',
        mdev: '2.247',
    })
})

test('reports 100 % loss and no times when nothing answers', () => {
    assert.deepEqual(ping.parseOutput(fixture('ping-unreachable.txt')), {
        packetsSent: '3',
        packetsPercent: '100',
    })
})

test('normalises a comma decimal in the loss percentage', () => {
    const output = fixture('ping-ok.txt').replace('0% packet loss', '16,6667% packet loss')

    assert.equal(ping.parseOutput(output).packetsPercent, '16.6667')
})

test('normalises comma decimals in round-trip times', { todo: 'only the loss percentage is normalised today' }, () => {
    const output = fixture('ping-ok.txt').replace('9.028/10.783/14.007/2.247', '9,028/10,783/14,007/2,247')

    assert.equal(ping.parseOutput(output).avg, '10.783')
})

test('returns no fields for output it does not recognise', () => {
    assert.deepEqual(ping.parseOutput('ping: unknown host'), {})
})
