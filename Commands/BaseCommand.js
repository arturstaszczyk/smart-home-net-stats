export const command = (commandType, options) => {
    const command = new commandType(options)
    console.log(`Starting execution of ${command.constructor.name}`)

    return command.execute(options)
}
