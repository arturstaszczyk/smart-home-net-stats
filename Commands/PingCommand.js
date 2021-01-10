import _ from 'lodash'
import { exec } from 'child_process'

const DEFAULT_PING_COUNT = 5
const DEFAULT_PING_ADDRESS = 'google.com'

export default class PingCommand {

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

        console.log(`Pinging ${address}...`)
        return new Promise((resolve, reject) => {

            const tags = { address }
            const metrics = {}
            let metricName = null

            const ls = exec(`ping -c ${pingCount} ${address}`, (error, stdout, stderr) => {

                if (!error) {
                    metricName = 'ping'
                    _.assign(metrics, this.parseOutput(stdout))

                    console.log(`--Found ping metrics for address ${address} and pingCount ${pingCount}`)
                    console.log(metrics)
                } else {
                    metricName = 'pingError'
                    _.assign(tags, { error:  'error' })
                    _.assign(metrics, { count: '1' })

                    console.log(`--ping error for address ${address} and pingCount ${pingCount}`)
                    console.log(error)
                    console.log(stderr)
                }
            })

            ls.on('close', (code, message) => {
                const pingResults = { metricName, metrics, tags }

                console.log(`--On subprocess close: Exit code: ${code}`)
                console.log(message)
                console.log('Ping command returing output:')
                console.log(pingResults)

                if (code) {
                    reject(pingResults)
                } else {
                    resolve(pingResults)
                }
            })
        })
    }
}