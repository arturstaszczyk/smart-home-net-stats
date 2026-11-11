import { test } from 'node:test'
import assert from 'node:assert/strict'
import BaseCommand, { command, DEFAULT_TIMEOUT_MS } from '../BaseCommand.js'
import PingCommand from '../PingCommand.js'

// Runs _execute and records the callbacks in the order they fire.
const run = (shellCommand, callbacks = {}, params) => new Promise((resolve) => {
    const calls = []
    new BaseCommand()._execute(shellCommand, 'TEST', {
        onSuccess: (stdout) => {
            calls.push(['success', stdout])
            if (callbacks.onSuccess) {
                callbacks.onSuccess(stdout)
            }
        },
        onError: () => {
            calls.push(['error'])
            if (callbacks.onError) {
                callbacks.onError()
            }
        },
        onClose: (...args) => {
            calls.push(['close', ...args])
            resolve(calls)
        },
    }, params)
})

// A minimal command following the same pattern as the real ones.
class FakeCommand extends BaseCommand {
    parseOutput(stdout) {
        return { value: stdout.trim() }
    }

    execute(options) {
        return new Promise((resolve) => {
            const tags = { computerTag: options.computerTag }
            const metrics = {}
            let metricName = ''

            super._execute(options.shell, 'FAKE', {
                onSuccess: (stdout) => {
                    metricName = 'fake'
                    Object.assign(metrics, this.parseOutput(stdout))
                },
                onError: () => {
                    metricName = 'fakeError'
                    Object.assign(tags, { error: 'error' })
                    Object.assign(metrics, { count: '1' })
                },
                onClose: () => resolve({ metricName, metrics, tags }),
            }, options.params)
        })
    }
}

class ThrowingParserCommand extends FakeCommand {
    parseOutput() {
        throw new Error('unexpected output')
    }
}

const fakeError = { metricName: 'fakeError', metrics: { count: '1' }, tags: { computerTag: 'pi9', error: 'error' } }

test('calls onSuccess with stdout, then onClose, for a command that exits 0', async () => {
    assert.deepEqual(await run('echo hi'), [['success', 'hi\n'], ['close']])
})

test('calls onError, then onClose, for a command that exits non-zero', async () => {
    assert.deepEqual(await run('sh -c "exit 3"'), [['error'], ['close']])
})

test('calls onError, then onClose, when onSuccess throws', async () => {
    const calls = await run('echo hi', { onSuccess: () => { throw new Error('parser bug') } })

    assert.deepEqual(calls, [['success', 'hi\n'], ['error'], ['close']])
})

test('still calls onClose when onError throws', async () => {
    const calls = await run('sh -c "exit 3"', { onError: () => { throw new Error('handler bug') } })

    assert.deepEqual(calls, [['error'], ['close']])
})

test('calls onError, then onClose, for a command that exceeds the timeout', async () => {
    const started = Date.now()
    const calls = await run('sleep 5', {}, { timeout: 200 })

    assert.deepEqual(calls, [['error'], ['close']])
    assert.ok(Date.now() - started < 4000, 'the command was not killed at the timeout')
})

test('kills a timed-out command even if it ignores SIGTERM', async () => {
    const started = Date.now()
    const calls = await run('trap "" TERM; sleep 5', {}, { timeout: 200 })

    assert.deepEqual(calls, [['error'], ['close']])
    assert.ok(Date.now() - started < 4000, 'the command was not killed at the timeout')
})

test('has a default timeout that leaves room for a 6-packet ping to an unreachable host (~15 s)', () => {
    assert.ok(DEFAULT_TIMEOUT_MS >= 16000 && DEFAULT_TIMEOUT_MS <= 30000)
})

// The contract: commands always resolve, never reject. A failure is the *Error metric,
// with the same { metricName, metrics, tags } shape that index.js writes to InfluxDB.
test('a command resolves with its metric when the shell command exits 0', async () => {
    assert.deepEqual(await command(FakeCommand, { shell: 'echo 42', computerTag: 'pi9' }),
        { metricName: 'fake', metrics: { value: '42' }, tags: { computerTag: 'pi9' } })
})

test('a command resolves with its error metric when the shell command exits non-zero', async () => {
    assert.deepEqual(await command(FakeCommand, { shell: 'sh -c "exit 3"', computerTag: 'pi9' }), fakeError)
})

test('a command resolves with its error metric when its parser throws', async () => {
    assert.deepEqual(await command(ThrowingParserCommand, { shell: 'echo 42', computerTag: 'pi9' }), fakeError)
})

test('a command resolves with its error metric when it times out', async () => {
    assert.deepEqual(
        await command(FakeCommand, { shell: 'sleep 5', computerTag: 'pi9', params: { timeout: 200 } }),
        fakeError)
})

test('a real command (PingCommand) turns a parser exception into pingError', async (t) => {
    t.mock.method(PingCommand.prototype, 'parseOutput', () => {
        throw new Error('unexpected output')
    })

    // `ping -c 1 127.0.0.1` may fail where ICMP is not allowed; either way the result is pingError.
    assert.deepEqual(await command(PingCommand, { address: '127.0.0.1', pingCount: 1, computerTag: 'pi9' }), {
        metricName: 'pingError',
        metrics: { count: '1' },
        tags: { address: '127.0.0.1', computerTag: 'pi9', error: 'error' },
    })
})

test('command() instantiates the command type and runs execute with the options', async () => {
    class OptionsCommand extends BaseCommand {
        execute(options) {
            return Promise.resolve({ metricName: 'fake', metrics: {}, tags: options })
        }
    }

    assert.deepEqual(await command(OptionsCommand, { computerTag: 'pi9' }),
        { metricName: 'fake', metrics: {}, tags: { computerTag: 'pi9' } })
})
