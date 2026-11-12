import { exec } from 'child_process'

// Kill limit for one command, in ms, unless the command passes its own `timeout`.
// The slowest normal frequent-batch command is a 6-packet ping to an unreachable host
// (~15 s: 6 s of packets plus ping's 10 s wait for late replies); curl is capped at 10 s
// by timedcurl.sh and DnsCommand passes 10 s. 20 s leaves room for all of them.
export const DEFAULT_TIMEOUT_MS = 20000

export const command = (commandType, options) => {
    const command = new commandType(options)
    console.log(`Starting execution of ${command.constructor.name}`)

    return command.execute(options)
}

export default class BaseCommand {

    // eslint-disable-next-line no-unused-vars
    execute(options) {

    }

    // Runs `command` and calls onSuccess(stdout) or onError(), then onClose(), exactly once each
    // way. A command that exits non-zero, times out or cannot start goes to onError. If onSuccess
    // throws (e.g. a parser fails), the error is logged and onError runs instead, so the command
    // still produces its error metric and the batch continues. onClose gets no arguments: every
    // command resolves, with its error metric on failure.
    _execute(command, commandName, callbacks, params) {

        const { onSuccess, onError, onClose } = callbacks

        const attempt = (stage, callback, ...args) => {
            try {
                callback(...args)
                return true
            } catch (exception) {
                console.log(`Command ${commandName}: ${stage} threw: ${exception.stack || exception}`)
                return false
            }
        }

        // SIGKILL: exec only reports a timed-out command once the process has exited, so it must
        // not be able to ignore the signal.
        const options = { timeout: DEFAULT_TIMEOUT_MS, killSignal: 'SIGKILL', ...params }
        const finish = (error, stdout, stderr) => {

            if (!error) {
                console.log(`Command ${commandName} successful`)
                if (!attempt('onSuccess', onSuccess, stdout)) {
                    attempt('onError', onError)
                }

            } else {
                if (error.killed && error.signal) {
                    console.log(`Command ${commandName} killed with ${error.signal} (timeout ${options.timeout} ms)`)
                } else {
                    console.log(`Command ${commandName} failed with error code ${error.code}: ${error.message}`)
                }
                console.log(stderr)
                attempt('onError', onError)
            }

            console.log(`Command ${commandName} closed`)
            onClose()
        }

        // exec's callback runs exactly once: on exit, after a timeout kill, or on a spawn failure.
        try {
            exec(command, options, finish)
        } catch (error) {
            finish(error, '', '')
        }
    }
}
