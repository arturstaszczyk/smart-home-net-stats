import _ from 'lodash'
import { exec } from 'child_process'

const DEFAULT_INTERFACE = 'wlan0'

export default class DataUsedCommand {

    parseOutput(stdout, options) {
        const output = {}
        const oldDownloadBytes = options.oldDownloadBytes || 0
        const oldUploadBytes = options.oldUploadBytes || 0

        console.log(options)

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

        return new Promise((resolve, reject) => {

            let metricName = null
            const tags = {}
            const metrics = {}

            const ifconfig = exec(`/usr/sbin/ifconfig ${inetInterface}`, (error, stdout, stderr) => {
                if (!error) {
                    metricName = 'dataUsed'
                    _.assign(metrics, this.parseOutput(stdout, options))

                    console.log(`--Found DataUsage metrics for interface ${inetInterface}`)
                    console.log(metrics)
                } else {
                    metricName = 'dataUsedError'
                    _.assign(tags, { error: 'error' })
                    _.assign(metrics, { count: '1' })

                    console.log(`--DataUsed command (ifconfig) error for interface ${inetInterface}`)
                    console.log(error)
                    console.log(stderr)
                }
            })

            ifconfig.on('close', (code, message) => {
                const testResults = { metricName, metrics, tags }

                console.log(`--On subprocess close: Exit code: ${code}`)
                console.log(message)
                console.log('DataUsed command (ifconfig) returing output:')
                console.log(testResults)

                if (code) {
                    reject(testResults)
                } else {
                    resolve(testResults)
                }
            })
        })
    }

}

// def get_total_bytes_transferred(downloaded=True):
//     try:
//         total_bytes_response = subprocess.run(["/usr/sbin/ifconfig", "wlan0"], capture_output=True)

//         

//     except ex:
//         print(ex)
//         total_bytes_transferred = None

//     return total_bytes_transferred

// def get_download_speed():

//     try:

//         download_response = subprocess.Popen('/home/pi/go/bin/fast-cli', 
//                             shell=True, 
//                             stdout=subprocess.PIPE).stdout.read().decode('utf-8')

//         print(download_response)

//         download_speed = re.findall('([0-9]+.[0-9]+\sMbps)', download_response, re.MULTILINE)
//         download_speed = download_speed[-1][:5] # get last measurement, without ' Mbps' string
//     except:
//         download_speed = 0.0

//     return float(download_speed)

// i_bytes = get_total_bytes_transferred()
// print(i_bytes)

// o_bytes = get_total_bytes_transferred(False)
// print(o_bytes)

// download_speed = get_download_speed()

// if(download_speed):
//     speed_data = [
//         {
//             "measurement": "internet_speed",
//             "tags" : {
//                 "host": "RaspberryPi1"
//             },
//             "fields" : {
//                 "download": download_speed,
//                 "total_downloaded": i_bytes / 1024 / 1024,
//                 "total_uploaded": o_bytes / 1024 / 1024
//             }
//         }
//     ]

// print(speed_data)
