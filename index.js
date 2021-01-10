require('dotenv').config()

import PingCommand from './Commands/PingCommand'
import CurlCommand from './Commands/CurlCommand'
import command from './Commands/command'
import InfluxWriter from './Influx/influxWriter'
import _ from 'lodash'

const DEFAULT_PING_COUNT = 6

const commands = [
    [PingCommand, { address: 'wp.pl', pingCount: DEFAULT_PING_COUNT }],
    [PingCommand, { address: 'pl.wikipedia.org', pingCount: DEFAULT_PING_COUNT }],
    [PingCommand, { address: 'google.com', pingCount: 2 }],
    [PingCommand, { address: process.env.ROUTER_1, pingCount: DEFAULT_PING_COUNT }],
    [PingCommand, { address: process.env.ROUTER_2, pingCount: DEFAULT_PING_COUNT }],
    [CurlCommand, { address: 'https://www.google.com' }],
    [CurlCommand, { address: 'https://www.wp.pl' }],
    [CurlCommand, { address: 'https://www.wikipedia.org' }],
    [CurlCommand, { address: process.env.ROUTER_1 }],
    [CurlCommand, { address: process.env.ROUTER_2 }],
]

const mainloop = async () => {

    const influxWriter = new InfluxWriter()
    const outputs = []

    for (const commandDef of commands) {
        try {
            outputs.push(await command(...commandDef))
        } catch (errorMetrics) {
            outputs.push(errorMetrics)
        }
    }

    console.log('--ALL COMMANDS EXECUTED')

    _.forEach(outputs, (singleCommandOutput) => {
        influxWriter.storeMetrics(singleCommandOutput.metricName, singleCommandOutput.tags, singleCommandOutput.metrics)
    })
}

console.log('================= STARTING ================')
const now = new Date()
console.log(now.toString())

mainloop()