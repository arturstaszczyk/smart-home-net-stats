import _ from 'lodash'
import BaseCommand from './BaseCommand'

const DEFAULT_CURL_ADDRESS = 'google.com'

export default class CurlCommand extends BaseCommand {

    parseOutput(stdout) {

        const curlStats = {}
        const namelookup = stdout.match(/time_namelookup:\s+([0-9]+[\.,][0-9]+)/)
        const total = stdout.match(/time_total:\s+([0-9]+[\.,][0-9]+)/)

        curlStats['namelookup'] = namelookup && namelookup[1].replace(',', '.')
        curlStats['total'] = total && total[1].replace(',', '.')

        return curlStats
    }

    execute(options) {

        const address = options.address || DEFAULT_CURL_ADDRESS
        const commandName = 'CURL'
        console.log(`Command ${commandName}: '${address}'`)

        return new Promise((resolve, reject) => {

            const tags = { address }
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