import _ from 'lodash'
import BaseCommand from './BaseCommand.js'

const DEFAULT_CURL_ADDRESS = 'google.com'

export default class CurlCommand extends BaseCommand {

    parseOutput(stdout) {

        // Cumulative timings in seconds, in request order. For plain HTTP appconnect is 0,
        // so per-phase durations should be split at pretransfer, not appconnect.
        const timings = ['namelookup', 'connect', 'appconnect', 'pretransfer', 'starttransfer', 'total']

        const curlStats = {}
        _.forEach(timings, (timing) => {
            const match = stdout.match(new RegExp(`time_${timing}:\\s+([0-9]+[.,][0-9]+)`))
            curlStats[timing] = match && match[1].replace(',', '.')
        })

        return curlStats
    }

    execute(options) {

        const address = options.address || DEFAULT_CURL_ADDRESS
        const computerTag = options.computerTag || 'UNKNOWN'
        const commandName = 'CURL'
        console.log(`Command ${commandName}: '${address}'`)

        return new Promise((resolve, reject) => {

            const tags = { address, computerTag }
            const metrics = {}
            let metricName = ''

            super._execute(`${process.cwd()}/timedcurl.sh ${address}`, commandName, {
                onSuccess: (stdout) => {
                    metricName = 'curl'
                    _.assign(metrics, this.parseOutput(stdout))

                    console.log(`Found ${commandName} metrics for address ${address}`)
                    console.log(metrics)
                },
                onError: () => {
                    metricName = 'curlError'
                    _.assign(tags, { error: 'error' })
                    _.assign(metrics, { count: '1' })

                    console.log(`${commandName} error for address ${address}`)
                },
                onClose: (error) => {
                    const curlResults = { metricName, metrics, tags }

                    if (error) {
                        reject(curlResults)
                    } else {
                        resolve(curlResults)
                    }
                }
            })

        })
    }
}