require('dotenv').config()
import _ from 'lodash'

import { ArgumentParser } from 'argparse'

import { command } from './Commands/BaseCommand'
import PingCommand from './Commands/PingCommand'
import CurlCommand from './Commands/CurlCommand'
import DataUsedCommand from './Commands/DataUsedCommand'
import SpeedTestCommand from './Commands/SpeedTestCommand'

import InfluxWriter from './Influx/influxWriter'

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
 //   [SpeedTestCommand],
]

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