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

import BaseCommand from './BaseCommand'

export default class SpeedTestCommand extends BaseCommand {

    execute(options) {

        const commandName = 'SPEED'

        console.log(`Starting ${commandName} command`)
        return new Promise((resolve, reject) => {

            let metricName = ''
            const metrics = []
            const tags = []

            super._execute('speedtest-cli --simple', commandName, {
                onSuccess: (stdout) => {
                    console.log(stdout)
                },
                onError: () => {

                },
                onClose: (error) => {
                    const pingResults = { metricName, metrics, tags }
                    console.log(pingResults)

                    if (error) {
                        reject(pingResults)
                    } else {
                        resolve(pingResults)
                    }
                }
            })
        })
    }
}
