# Test fixtures

Real output of the commands the service shells out to, captured on 2026-10-14 (Ubuntu, iputils `ping`, curl, net-tools `ifconfig`, Ookla Speedtest CLI 1.2.0). Tests parse these instead of running the commands, so they need no network.

| File | Captured with |
| --- | --- |
| `ping-ok.txt` | `ping -c 6 google.com` |
| `ping-unreachable.txt` | `ping -c 3 -W 1 192.0.2.1` (exit code 1) |
| `curl-https.txt` | `./timedcurl.sh https://www.google.com` |
| `curl-http.txt` | `./timedcurl.sh 192.168.1.1` (plain HTTP, so `time_appconnect` is 0) |
| `ifconfig-lo.txt` | `/usr/sbin/ifconfig lo` |
| `speedtest-ok.json` | `speedtest --accept-license --accept-gdpr --format=json --progress=no` |

Network-identifying values were replaced with documentation values: the ISP router in `ping-unreachable.txt` (`203.0.113.1`), and in `speedtest-ok.json` the IP and MAC addresses, ISP name and result ID. Measurements are unchanged.

To add a fixture, run the command from `Service/`, redirect stdout to a file here, scrub addresses the same way, and add a row above. Comma-decimal (e.g. Polish locale) variants are derived in the tests from these files rather than stored separately.
