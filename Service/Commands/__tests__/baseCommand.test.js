import { test } from 'node:test'
import assert from 'node:assert/strict'
import BaseCommand, { command } from '../BaseCommand.js'

// Runs _execute and records the callbacks in the order they fire.
const run = (shellCommand) => new Promise((resolve) => {
    const calls = []
    new BaseCommand()._execute(shellCommand, 'TEST', {
        onSuccess: (stdout) => calls.push(['success', stdout]),
        onError: () => calls.push(['error']),
        onClose: (...args) => {
            calls.push(['close', ...args])
            resolve(calls)
        },
    })
})

test('calls onSuccess with stdout, then onClose, for a command that exits 0', async () => {
    assert.deepEqual(await run('echo hi'), [['success', 'hi\n'], ['close']])
})

test('calls onError, then onClose, for a command that exits non-zero', async () => {
    assert.deepEqual(await run('sh -c "exit 3"'), [['error'], ['close']])
})

// onClose gets no exit code, so the `if (error) reject(...)` branch in every command never runs:
// commands always resolve, and a failure is signalled by the *Error metric name instead.
test('passes no exit code to onClose', async () => {
    const calls = await run('sh -c "exit 3"')

    assert.deepEqual(calls.at(-1), ['close'])
})

test('command() instantiates the command type and runs execute with the options', async () => {
    class FakeCommand extends BaseCommand {
        execute(options) {
            return Promise.resolve({ metricName: 'fake', metrics: {}, tags: options })
        }
    }

    assert.deepEqual(await command(FakeCommand, { computerTag: 'pi9' }),
        { metricName: 'fake', metrics: {}, tags: { computerTag: 'pi9' } })
})
