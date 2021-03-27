import _ from 'lodash'
import BaseCommand from './BaseCommand'

export default class SpeedTestCommand extends BaseCommand {

    parseOutput(stdout) {
        const speedStats = {}
        const download = stdout.match(/Download: ([0-9]+[.,]{1}[0-9]+)\s+/)
        const upload = stdout.match(/Upload: ([0-9]+[.,]{1}[0-9]+)\s+/)

        speedStats['download'] = download && download[1].replace(',', '.')
        speedStats['upload'] = upload && upload[1].replace(',', '.')

        return speedStats
    }

    execute() {

        const commandName = 'SPEED'
        const computerTag = options.computerTag || 'UNKNOWN'

        console.log(`Starting ${commandName} command`)
        return new Promise((resolve, reject) => {

            let metricName = ''
            const metrics = {}
            const tags = { computerTag }

            super._execute('speedtest-cli --simple', commandName, {
                onSuccess: (stdout) => {
                    metricName = 'speedtest'
                    _.assign(metrics, this.parseOutput(stdout))

                    console.log(`Found ${commandName} metrics`)
                    console.log(metrics)
                },
                onError: () => {
                    metricName = 'speedtest-error'
                    _.assign(tags, { error: 'error' })
                    _.assign(metrics, { count: '1' })
                },
                onClose: (error) => {
                    const speedResults = { metricName, metrics, tags }
                    if (error) {
                        reject(speedResults)
                    } else {
                        resolve(speedResults)
                    }
                }
            }, {
                timeout: 100000
            })
        })
    }
}
