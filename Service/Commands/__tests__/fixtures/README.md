# Test fixtures

These files contain real output of the commands that the service runs. The output was recorded on 2026-10-14 on Ubuntu, with iputils `ping`, curl, net-tools `ifconfig` and the Ookla Speedtest CLI 1.2.0. The tests read these files and do not run the commands. Thus, the tests do not use the network.

| File | Command that made the file |
| --- | --- |
| `ping-ok.txt` | `ping -c 6 google.com` |
| `ping-unreachable.txt` | `ping -c 3 -W 1 192.0.2.1` (exit code 1) |
| `curl-https.txt` | `./timedcurl.sh https://www.google.com` |
| `curl-http.txt` | `./timedcurl.sh 192.168.1.1` (HTTP without TLS, thus `time_appconnect` is 0) |
| `ifconfig-lo.txt` | `/usr/sbin/ifconfig lo` |
| `speedtest-ok.json` | `speedtest --accept-license --accept-gdpr --format=json --progress=no` |

Values that identify the network were replaced with documentation values. In `ping-unreachable.txt`, this is the router of the ISP (`203.0.113.1`). In `speedtest-ok.json`, these are the IP addresses, the MAC address, the ISP name and the result ID. The measurements did not change.

To add a fixture, do these steps:

1. Run the command in `Service/`.
2. Write its standard output to a file in this directory.
3. Replace the addresses as in the other files.
4. Add a row to the table above.

The tests make the variants with a comma as the decimal mark (for example, for the Polish locale) from these files. Thus, there are no separate files for these variants.
