// eslint-disable-next-line no-undef
require('dotenv').config()

import { exec } from 'child_process'
import _ from 'lodash'
import { InfluxDB, Point } from '@influxdata/influxdb-client'

const bucket = `${process.env.INFLUX_DB}/${process.env.INFLUX_RETENTION}`
const clientOptions = {
    url: `http://${process.env.INFLUX_HOST}:${process.env.INFLUX_PORT}`,
    token: `${process.env.INFLUX_USER}:${process.env.INFLUX_PASS}`
}

const influxDB = new InfluxDB(clientOptions)
const writeAPI = influxDB.getWriteApi('', bucket)

export const makeCurl = async (address) => {
    return new Promise((resolve, reject) => {

        let foundError = null
        const curlStats = {}

        const curl = exec(`${process.cwd()}/timedcurl.sh ${address}`, (error, stdout, stderr) => {
            if (!error) {
                console.log(stdout)
                const namelookup = stdout.match(/time_namelookup:\s+([0-9]+,[0-9]+)/)
                const total = stdout.match(/time_total:\s+([0-9]+,[0-9]+)/)

                curlStats['namelookup'] = namelookup && namelookup[1].replace(',', '.')
                curlStats['total'] = total && total[1].replace(',', '.')
            } else {
                foundError = stderr
            }
        })

        curl.on('close', (code, message) => {
            console.log(`Exit code: ${code}`)
            if (code) {
                reject(`Error code ${code} with message ${message} and ${foundError}`)
            } else {

                const point = new Point('curl').tag('address', address)
                    .floatField('namelookup', curlStats.namelookup)
                    .floatField('total', curlStats.total)

                console.log('Writing timeseries:')
                console.log(point)
                writeAPI.writePoint(point)
                writeAPI.flush()

                resolve(curlStats)
            }
        })
    })
}

export const makePing = async (address, count) => {
    return new Promise((resolve, reject) => {
        let foundError = null
        const pingResults = []
        const pingStats = {}

        const ls = exec(`ping -c ${count} ${address}`, (error, stdout, stderr) => {

            if (!error) {
                const lines = stdout.split('\n')
                console.log(lines)
                _.forEach(lines, (item) => {
                    const numberOfBytes = item.match(/^[0-9]+/)
                    const ipAddtess = item.match(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/)
                    const time = item.match(/([0-9]+\.[0-9]+) ms/)
                    const singleEntry = {}

                    if (numberOfBytes && ipAddtess && time) {
                        //console.log(numberOfBytes[0], ipAddtess[0], time[1])

                        singleEntry['numberOfBytes'] = numberOfBytes[0]
                        singleEntry['ipAddress'] = ipAddtess[0]
                        singleEntry['time'] = time[1]

                        pingResults.push(singleEntry)
                    }

                    const packetsSent = item.match(/^[0-9]+/)
                    const packetsPercent = item.match(/([0-9]*,{0,1}[0-9]+)%/)
                    if (packetsSent && packetsPercent) {
                        //console.log(packetsSent[0], packetsPercent[0])

                        pingStats['packetsSent'] = packetsSent[0]
                        pingStats['packetsPercent'] = packetsPercent[1].replace(',', '.')
                    }


                    let stats = item.match(/([0-9]+.[0-9]+\/){3}[0-9]+.[0-9]+/)
                    if (stats) {
                        stats = stats[0].split('/')
                        //console.log(stats)

                        pingStats['min'] = stats[0]
                        pingStats['avg'] = stats[1]
                        pingStats['max'] = stats[2]
                        pingStats['mdev'] = stats[3]
                    }


                })
            } else {
                foundError = error
                console.log(stderr)
            }

        })

        ls.on('close', (code, message) => {
            console.log(`Exit code: ${code}`)
            if (code) {
                reject(`Error code ${code} with message ${message} and ${foundError}`)
            } else {

                const point = new Point('ping').tag('address', address)
                    .floatField('min', pingStats.min)
                    .floatField('avg', pingStats.avg)
                    .floatField('max', pingStats.max)
                    .floatField('mdev', pingStats.mdev)
                    .floatField('packetLoss', pingStats.packetsPercent)

                console.log('Writing timeseries:')
                console.log(point)
                writeAPI.writePoint(point)
                writeAPI.flush()

                resolve(pingResults)
            }
        })
    })
}

const mainloop = async () => {
    try {
        await makePing('google.com', 6)
    } catch (error) {
        console.log(error)
    }

    try {
        await makePing('wp.pl', 6)
    } catch (error) {
        console.log(error)
    }
    
    try {
        await makePing('pl.wikipedia.org', 6)
    } catch (error) {
        console.log(error)
    }

    try {
        await makePing(process.env.ROUTER_1, 6)
    } catch (error) {
        console.log(error)
    }

    try {
        await makePing(process.env.ROUTER_2, 6)
    } catch (error) {
        console.log(error)
    }
    
    try {
        await makeCurl('https://www.google.com')
    } catch (error) {
        console.log(error)
    }

    try {
        await makeCurl('https://www.wp.pl')
    } catch (error) {
        console.log(error)
    }

    try {
        await makeCurl('https://www.wikipedia.org')
    } catch (error) {
        console.log(error)
    }

    try {
        await makeCurl(process.env.ROUTER_1)
    } catch (error) {
        console.log(error)
    }

    try {
        await makeCurl(process.env.ROUTER_2)
    } catch (error) {
        console.log(error)
    }
}

console.log('================= STARTING ================')
const now = new Date()
console.log(now.toString())
mainloop()