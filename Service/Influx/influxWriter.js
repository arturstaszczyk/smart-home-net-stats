require('dotenv').config()

import { InfluxDB, Point } from '@influxdata/influxdb-client'
import _ from 'lodash'

const bucket = `${process.env.INFLUX_DB}/${process.env.INFLUX_RETENTION}`
const clientOptions = {
    url: `http://${process.env.INFLUX_HOST}:${process.env.INFLUX_PORT}`,
    token: `${process.env.INFLUX_USER}:${process.env.INFLUX_PASS}`
}

export default class InfluxWriter {
    constructor() {
        this.influxDB = new InfluxDB(clientOptions)
        this.writeAPI = this.influxDB.getWriteApi('', bucket)
        this.queryAPI = this.influxDB.getQueryApi('')

        console.log(`Creating Influx Writer for address ${process.env.INFLUX_HOST} and port ${process.env.INFLUX_PORT}`)
    }

    storeMetrics(metric, tags, floadFields) {
        const point = new Point(metric)

        _.forEach(tags, (value, key) => {
            point.tag(key, value)
        })

        _.forEach(floadFields, (value, key) => {
            point.floatField(key, value)
        })

        console.log('Writing timeseries:')
        console.log(point)

        try {
            this.writeAPI.writePoint(point)
            this.writeAPI.flush()
        } catch (error) {
            console.log(error)
        }
    }

    getMetrics(metric, field, time) {

        return new Promise((resolve, reject) => {

            const result = []

            const query = `from(bucket: "${bucket}") |> range(start: -${time}) |> filter(fn: (r) => r._measurement == "${metric}" and r._field == "${field}") |> last()`
            this.queryAPI.queryRows(query, {
                next(row, tableMeta) {
                    const rowAsObject = tableMeta.toObject(row)
                    result.push({
                        [field]: rowAsObject._value
                    })
                },
                error(error) {
                    reject(error)
                },
                complete() {
                    resolve(result)
                }
            })
        })

    }
}