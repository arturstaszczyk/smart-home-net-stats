import _ from 'lodash'
import BaseCommand from './BaseCommand'

const DEFAULT_PING_COUNT = 5
const DEFAULT_PING_ADDRESS = 'google.com'

export default class PingCommand extends BaseCommand {

    parseOutput(stdout) {

        const pingStats = {}

        const lines = stdout.split('\n')
        _.forEach(lines, (item) => {

            const packetsSent = item.match(/^[0-9]+/)
            const packetsPercent = item.match(/([0-9]*[\.,]{0,1}[0-9]+)%/)

            if (packetsSent && packetsPercent) {
                pingStats.packetsSent = packetsSent[0]
                pingStats.packetsPercent = packetsPercent[1].replace(',', '.')
            }

            let stats = item.match(/([0-9]+.[0-9]+\/){3}[0-9]+.[0-9]+/)
            if (stats) {
                stats = stats[0].split('/')

                pingStats['min'] = stats[0]
                pingStats['avg'] = stats[1]
                pingStats['max'] = stats[2]
                pingStats['mdev'] = stats[3]
            }
        })

        return pingStats
    }

    execute(options) {
        const address = options.address || DEFAULT_PING_ADDRESS
        const pingCount = options.pingCount || DEFAULT_PING_COUNT
        const computerTag = options.computerTag || 'UNKNOWN'
        const commandName = 'PING'

        console.log(`Command ${commandName}: '${address}' ${pingCount} times`)

        return new Promise((resolve, reject) => {

            const tags = { address, computerTag }
            const metrics = {}
            let metricName = null

            const command = `ping -c ${pingCount} ${address}`

            super._execute(command, commandName, {
                onSuccess: (stdout) => {
                    metricName = 'ping'
                    _.assign(metrics, this.parseOutput(stdout))

                    console.log(`Found ${commandName} metrics for address ${address} and pingCount ${pingCount}`)
                    console.log(metrics)
                },
                onError: () => {
                    metricName = 'pingError'
                    console.log(`${commandName} error for address ${address} and pingCount ${pingCount}`)

                    _.assign(tags, { error:  'error' })
                    _.assign(metrics, { count: '1' })
                },
                onClose: (errorCode) => {
                    const pingResults = { metricName, metrics, tags }
                    if(errorCode) {
                        reject(pingResults)
                    } else { 
                        resolve(pingResults)
                    }
                }
            })
        })
    }
}