import _ from 'lodash'
import { exec } from 'child_process'

const DEFAULT_CURL_ADDRESS = 'google.com'

export default class CurlCommand {

    parseOutput(stdout) {

        const curlStats = {}
        const namelookup = stdout.match(/time_namelookup:\s+([0-9]+[\.,][0-9]+)/)
        const total = stdout.match(/time_total:\s+([0-9]+[\.,][0-9]+)/)
        
        curlStats['namelookup'] = namelookup && namelookup[1].replace(',', '.')
        curlStats['total'] = total && total[1].replace(',', '.')

        return curlStats
    }

    async execute(options) {

        const address = options.address || DEFAULT_CURL_ADDRESS
        console.log(`Starting curl command to ${address}`)

        return new Promise((resolve, reject) => {

            const tags = { address }
            const metrics = {}
            let metricName = ''

            const curl = exec(`${process.cwd()}/timedcurl.sh ${address}`, (error, stdout, stderr) => {
                if (!error) {
                    metricName = 'curl'
                    _.assign(metrics, this.parseOutput(stdout))

                    console.log(`--Found curl metrics for address ${address}`)
                    console.log(metrics)
                } else {
                    metricName = 'curlError'
                    _.assign(tags, { error: 'error' })
                    _.assign(metrics, { count: '1' })

                    console.log(`--curl error for address ${address}`)
                    console.log(error)
                    console.log(stderr)
                }
            })

            curl.on('close', (code, message) => {
                const curlResults = { metricName, metrics, tags }

                console.log(`--On subprocess close: Exit code: ${code}`)
                console.log(message)
                console.log('curl command returing output:')
                console.log(curlResults)

                if (code) {
                    reject(curlResults)
                } else {
                    resolve(curlResults)
                }
            })
        })
    }
}