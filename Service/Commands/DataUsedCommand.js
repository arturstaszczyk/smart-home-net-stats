import _ from 'lodash'
import { exec } from 'child_process'
import BaseCommand from './BaseCommand'

const DEFAULT_INTERFACE = 'wlan0'

export default class DataUsedCommand extends BaseCommand {

    parseOutput(stdout, options) {
        const output = {}
        const oldDownloadBytes = options.oldDownloadBytes || 0
        const oldUploadBytes = options.oldUploadBytes || 0

        const downloadBytes = stdout.match(/RX packets [0-9]+\s+bytes ([0-9]+)/)
        const uploadBytes = stdout.match(/TX packets [0-9]+\s+bytes ([0-9]+)/)

        output.downloadBytes = downloadBytes[1]
        output.uploadBytes = uploadBytes[1]
        output.diffDownloaded = output.downloadBytes - oldDownloadBytes
        output.diffUploaded = output.uploadBytes - oldUploadBytes

        return output
    }

    execute(options) {
        const inetInterface = options.inetInterface || DEFAULT_INTERFACE
        const commandName = 'DATA USED'

        console.log(`Starting execution of ${commandName} command`)

        return new Promise((resolve, reject) => {
            let metricName = null
            const tags = {}
            const metrics = {}

            super._execute(`/usr/sbin/ifconfig ${inetInterface}`, commandName, {
                onSuccess: (stdout) => {
                    metricName = 'dataUsed'
                    _.assign(metrics, this.parseOutput(stdout, options))

                    console.log(`Found ${commandName} metrics for interface ${inetInterface}`)
                    console.log(metrics)
                },
                onError: () => {
                    metricName = 'dataUsedError'
                    _.assign(tags, { error: 'error' })
                    _.assign(metrics, { count: '1' })
                    console.log(`${commandName} command (ifconfig) error for interface ${inetInterface}`)
                },
                onClose: (error) => {
                    const testResults = { metricName, metrics, tags }

                    if (error) {
                        reject(testResults)
                    } else {
                        resolve(testResults)
                    }
                }
            })
        })
    }

}
