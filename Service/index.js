import 'dotenv/config'
import _ from 'lodash'

import { command } from './Commands/BaseCommand.js'
import PingCommand from './Commands/PingCommand.js'
import CurlCommand from './Commands/CurlCommand.js'
import DataUsedCommand from './Commands/DataUsedCommand.js'
import SpeedTestCommand from './Commands/SpeedTestCommand.js'

import InfluxWriter from './Influx/influxWriter.js'

const DEFAULT_PING_COUNT = 6

const frequentCommands = [
    [PingCommand, { address: 'wp.pl', pingCount: DEFAULT_PING_COUNT, computerTag:process.env.COMPUTER_NAME }],
    [PingCommand, { address: 'pl.wikipedia.org', pingCount: DEFAULT_PING_COUNT, computerTag:process.env.COMPUTER_NAME }],
    [PingCommand, { address: 'google.com', pingCount: DEFAULT_PING_COUNT, computerTag:process.env.COMPUTER_NAME }],
    [PingCommand, { address: process.env.ROUTER_1, pingCount: DEFAULT_PING_COUNT, computerTag:process.env.COMPUTER_NAME }],
    [PingCommand, { address: '8.8.8.8', pingCount: DEFAULT_PING_COUNT, computerTag:process.env.COMPUTER_NAME }],
    [CurlCommand, { address: 'https://www.google.com', computerTag:process.env.COMPUTER_NAME }],
    [CurlCommand, { address: 'https://www.wp.pl', computerTag:process.env.COMPUTER_NAME }],
    [CurlCommand, { address: 'https://www.wikipedia.org', computerTag:process.env.COMPUTER_NAME }],
    [CurlCommand, { address: process.env.ROUTER_1, computerTag:process.env.COMPUTER_NAME }],
]

const infrequentCommands = [
    [SpeedTestCommand, { computerTag:process.env.COMPUTER_NAME, serverId: process.env.SPEED_TEST_SERVER_ID }],
]

// Disabled until Phase 3 makes DataUsedCommand safe; see the commented call in runCommands
// eslint-disable-next-line no-unused-vars
const measureDataUsed = async (influxAPI) => {
    const oldDownloadBytesArray = await influxAPI.getMetrics('dataUsed', 'downloadBytes', '15m')
    const oldUploadBytesArray = await influxAPI.getMetrics('dataUsed', 'uploadBytes', '15m')
    const oldDownloadBytes = oldDownloadBytesArray[0] ? oldDownloadBytesArray[0].downloadBytes : 0
    const oldUploadBytes = oldUploadBytesArray[0] ? oldUploadBytesArray[0].uploadBytes : 0

    let retValue = {}
    try {
        retValue = await command(DataUsedCommand, {
            inetInterface: process.env.WAN_INTERFACE,
            oldDownloadBytes,
            oldUploadBytes,
        })
    } catch (errorMetrics) {
        retValue = errorMetrics
    }

    return retValue
}

const runCommands = async (commands) => {

    const influxWriter = new InfluxWriter()
    const outputs = []

    for (const commandDef of commands) {
        try {
            outputs.push(await command(...commandDef))
        } catch (errorMetrics) {
            console.log(errorMetrics)
            outputs.push(errorMetrics)
        }
    }

    //outputs.push(await measureDataUsed(influxWriter))

    console.log('--ALL COMMANDS EXECUTED')

    _.forEach(outputs, (singleCommandOutput) => {
        influxWriter.storeMetrics(singleCommandOutput.metricName, singleCommandOutput.tags, singleCommandOutput.metrics)
    })
}

console.log('================= STARTING ================')
const now = new Date()
console.log(now.toString())

if (_.includes(process.argv, 'infrequent')) {
    runCommands(infrequentCommands)
} else if (_.includes(process.argv, 'frequent')) {
    runCommands(frequentCommands)
}