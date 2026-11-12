import _ from 'lodash'
import BaseCommand from './BaseCommand.js'

// Ookla reports bandwidth in bytes per second; it is stored in Mbit/s, as before.
const toMbits = (bytesPerSecond) => _.isNumber(bytesPerSecond) ? bytesPerSecond * 8 / 1000000 : undefined

// Plausible ranges (inclusive) for the stored values; anything outside is an Ookla glitch
// (e.g. upload.latency.iqm = 1488485955 ms on 2026-10-20) and is dropped so it can't skew averages.
const MAX_LATENCY_MS = 60000
const PLAUSIBLE_RANGES = {
    download: [0, 10000], // Mbit/s, i.e. up to 10 Gbit/s
    upload: [0, 10000],
    ping: [0, MAX_LATENCY_MS],
    jitter: [0, MAX_LATENCY_MS],
    packetLoss: [0, 100], // %
    downloadLatency: [0, MAX_LATENCY_MS],
    uploadLatency: [0, MAX_LATENCY_MS],
}

const isPlausible = (name, value) => {
    const range = PLAUSIBLE_RANGES[name]
    return !range || (value >= range[0] && value <= range[1])
}

export default class SpeedTestCommand extends BaseCommand {

    // Parses the JSON printed by Ookla's `speedtest --format=json`. Values the test did not
    // report (e.g. packetLoss on some servers) are left out rather than written as null.
    parseOutput(stdout) {
        let result
        try {
            result = JSON.parse(stdout)
        } catch (error) {
            console.log(`Speed test output is not valid JSON: ${error.message}`)
            return {}
        }

        const speedStats = {
            download: toMbits(_.get(result, 'download.bandwidth')),
            upload: toMbits(_.get(result, 'upload.bandwidth')),
            ping: _.get(result, 'ping.latency'),
            jitter: _.get(result, 'ping.jitter'),
            packetLoss: _.get(result, 'packetLoss'),
            // Latency while the link is saturated (bufferbloat), interquartile mean
            downloadLatency: _.get(result, 'download.latency.iqm'),
            uploadLatency: _.get(result, 'upload.latency.iqm'),
            serverId: _.get(result, 'server.id'),
        }

        const reported = _.omitBy(speedStats, (value) => !_.isFinite(value))
        return _.omitBy(reported, (value, name) => {
            if (isPlausible(name, value)) {
                return false
            }
            const [min, max] = PLAUSIBLE_RANGES[name]
            console.log(`Dropping implausible speed test value ${name}=${value} (expected ${min} to ${max})`)
            return true
        })
    }

    buildCommand(options) {
        const command = 'speedtest --accept-license --accept-gdpr --format=json --progress=no'
        const serverId = `${options.serverId || ''}`

        return /^[0-9]+$/.test(serverId) ? `${command} --server-id=${serverId}` : command
    }

    execute(options) {
        console.log('SpeedTestCommand.execute')
        const commandName = 'SPEED'
        const computerTag = options.computerTag || 'UNKNOWN'

        console.log(`Starting ${commandName} command on ${computerTag}`)
        return new Promise((resolve) => {

            let metricName = ''
            const metrics = {}
            const tags = { computerTag }

            super._execute(this.buildCommand(options), commandName, {
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
                onClose: () => resolve({ metricName, metrics, tags })
            }, {
                timeout: 100000
            })
        })
    }
}
