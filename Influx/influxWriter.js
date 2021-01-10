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
}