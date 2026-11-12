import 'dotenv/config'

import { InfluxDB, Point } from '@influxdata/influxdb-client'
import _ from 'lodash'

// Connection settings, read from the environment (Service/.env) unless given explicitly.
export const configFromEnv = (env = process.env) => ({
    host: env.INFLUX_HOST,
    port: env.INFLUX_PORT,
    db: env.INFLUX_DB,
    retention: env.INFLUX_RETENTION,
    user: env.INFLUX_USER,
    pass: env.INFLUX_PASS,
})

// One line for the log: status code and message for HTTP errors (e.g. 401 on a wrong
// INFLUX_PASS), the system error code otherwise (e.g. ECONNREFUSED when Influx is down).
export const describeWriteError = (error) => {
    if (error && error.statusCode) {
        // The client's message usually starts with the status already ("401 Unauthorized : ...").
        const message = String(error.message)
        return `HTTP ${message.startsWith(String(error.statusCode)) ? message : `${error.statusCode} ${message}`}`
    }
    if (error && error.code) {
        return `${error.code}: ${error.message}`
    }
    return String(error && error.message ? error.message : error)
}

// Influx float fields must be finite numbers; numeric strings are accepted, as before.
const toFloat = (value) => (typeof value === 'number' ? value : parseFloat(value))

export default class InfluxWriter {
    // `apis` is for tests: pass { writeApi, queryApi } stubs to avoid a real client.
    constructor(config = configFromEnv(), apis = {}) {
        this.bucket = `${config.db}/${config.retention}`

        let { writeApi, queryApi } = apis
        if (!writeApi || !queryApi) {
            const influxDB = new InfluxDB({
                url: `http://${config.host}:${config.port}`,
                token: `${config.user}:${config.pass}`,
            })
            writeApi = writeApi || influxDB.getWriteApi('', this.bucket)
            queryApi = queryApi || influxDB.getQueryApi('')
        }
        this.writeAPI = writeApi
        this.queryAPI = queryApi

        console.log(`Creating Influx Writer for address ${config.host} and port ${config.port}`)
    }

    // Queues one point; nothing is sent until flush(). Tags become Influx tags, metrics become
    // float fields. Fields that are not finite numbers are dropped. Returns false (and queues
    // nothing) when no field is left, since Influx rejects a point without fields.
    storeMetrics(metric, tags, floatFields) {
        const point = new Point(metric)

        _.forEach(tags, (value, key) => {
            point.tag(key, value)
        })

        let fieldCount = 0
        _.forEach(floatFields, (value, key) => {
            const float = toFloat(value)
            if (Number.isFinite(float)) {
                point.floatField(key, float)
                fieldCount++
            } else {
                console.log(`Dropping field ${metric}.${key}: not a finite number (${value})`)
            }
        })

        if (fieldCount === 0) {
            return false
        }

        console.log(`Writing timeseries: ${point.toLineProtocol()}`)
        this.writeAPI.writePoint(point)
        return true
    }

    // Sends every queued point in one request. Never rejects: returns true on success, or logs
    // the error and returns false.
    async flush() {
        try {
            await this.writeAPI.flush()
            return true
        } catch (error) {
            console.error(`Influx write failed, batch not stored: ${describeWriteError(error)}`)
            return false
        }
    }

    // Releases the client (cancels pending retries and timers). Never rejects.
    async close() {
        try {
            await this.writeAPI.close()
            return true
        } catch (error) {
            console.error(`Closing Influx writer failed: ${describeWriteError(error)}`)
            return false
        }
    }

    getMetrics(metric, field, time) {

        return new Promise((resolve, reject) => {

            const result = []

            const query = `from(bucket: "${this.bucket}") |> range(start: -${time}) |> filter(fn: (r) => r._measurement == "${metric}" and r._field == "${field}") |> last()`
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

// Queues every usable command result, flushes once and closes the writer. Results without a
// metricName or without any numeric field (e.g. a non-metric throw, or curl output with no
// timings) are skipped and logged. Never rejects; returns a summary for the caller and tests.
export const writeResults = async (influxWriter, outputs) => {
    let queued = 0
    let skipped = 0

    _.forEach(outputs, (output) => {
        const metricName = output && output.metricName
        const metrics = output && output.metrics
        let stored = false
        try {
            stored = Boolean(metricName) && _.isPlainObject(metrics)
                && influxWriter.storeMetrics(metricName, output.tags, metrics)
        } catch (error) {
            console.error(`Could not queue ${metricName}: ${describeWriteError(error)}`)
        }

        if (stored) {
            queued++
        } else {
            skipped++
            console.log('Skipping result with no metricName or no numeric fields:', output)
        }
    })

    const written = queued > 0 ? await influxWriter.flush() : true
    await influxWriter.close()

    if (queued > 0) {
        console.log(written
            ? `--WROTE ${queued} points to Influx (${skipped} skipped)`
            : `--FAILED to write ${queued} points to Influx (${skipped} skipped)`)
    } else {
        console.log(`--NOTHING to write to Influx (${skipped} skipped)`)
    }

    return { queued, skipped, written }
}
