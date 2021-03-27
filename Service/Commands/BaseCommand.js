import { exec } from 'child_process'

export const command = (commandType, options) => {
    const command = new commandType(options)
    console.log(`Starting execution of ${command.constructor.name}`)

    return command.execute(options)
}

export default class BaseCommand {

    // eslint-disable-next-line no-unused-vars
    execute(options) {

    }

    _execute(command, commandName, callbacks, params) {

        const { onSuccess, onError, onClose } = callbacks

        const ls = exec(command, {...params}, (error, stdout, stderr) => {

            if (!error) {
                console.log(`Command ${commandName} successful`)
                onSuccess(stdout)

            } else {
                console.log(`Command ${commandName} failed with error code ${error}`)
                console.log(stderr)
                onError()
            }
        })

        ls.on('close', (errorCode, message) => {
            console.log(`Command ${commandName} closed: Exit code: ${errorCode}`)
            console.log(message)

            onClose()
        })
    }
}