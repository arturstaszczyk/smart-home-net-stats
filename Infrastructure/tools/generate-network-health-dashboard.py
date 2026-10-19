"""Generates the "Network health v2.2" Grafana dashboard.

Writes ../grafana/dashboards/network-health-v2.2.json (relative to this script), which Grafana
provisions automatically within 30 seconds. Python 3 standard library only:

    python3 Infrastructure/tools/generate-network-health-dashboard.py [output.json]

The generated JSON is committed; edit this script and regenerate rather than editing the JSON
by hand. See Infrastructure/README.md, "Dashboards". network-health-v2.0.json and v2.1.json are the
frozen outputs of earlier versions of this script. Needs Grafana 13 (circular gauges with sparklines).
"""
import re
import json
import sys
from pathlib import Path

VERSION = '2.2'
UID = 'smart-home-network-v2-2'
OUTPUT = Path(__file__).resolve().parent.parent / 'grafana' / 'dashboards' / f'network-health-v{VERSION}.json'

DS = {'type': 'influxdb', 'uid': 'smart-home-influxdb'}
LAN = r'/^(10|127|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\./'
NODE = '"computerTag" =~ /^$node$/'
TARGET = '"address" =~ /^$target$/'

# Expected speed (Mbit/s) per node. Nodes not listed here, and every new node, expect PLAN.
# Speed results are judged against the node's own expectation:
# orange below WARN_BELOW of it, red below CRIT_BELOW.
PLAN = {'download': 1000, 'upload': 100}
NODE_EXPECTED = {
    'pi113': {'download': 50, 'upload': 50},    # Pi 3B Wi-Fi ceiling (2.4 GHz, 1x1, 20 MHz): ~40-60 real
    'pi105': {'download': 6, 'upload': 18},     # canary in poor radio coverage: its normal level
}
WARN_BELOW, CRIT_BELOW = 0.80, 0.50

# Validated categorical slots (dataviz reference palette, dark steps; all-pairs safe for 3).
NODE_COLORS = {'pi3': '#3987e5', 'pi4': '#d95926', 'pi5': '#199e70'}
# Targets: same site, same color in ping and curl panels. Adjacent-pair safe (lines + legend).
TARGET_COLORS = [('google', '#3987e5'), ('wp\\.pl', '#d95926'), ('wikipedia', '#199e70'),
                 ('8\\.8\\.8\\.8', '#c98500'), ('^(10|127|192\\.168|172\\.)', '#d55181')]
PHASE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']
FAILURE_COLORS = {'ping failures': '#9085e9', 'curl failures': '#d55181', 'speed test failures': '#c98500'}

_id = [0]


def nid():
    _id[0] += 1
    return _id[0]


def q(query, alias='', ref='A', fmt='time_series'):
    return {'datasource': DS, 'refId': ref, 'query': query, 'rawQuery': True,
            'resultFormat': fmt, 'alias': alias}


def steps(*pairs):
    """steps('green', (40, 'orange'), (100, 'red'))"""
    out = [{'color': pairs[0], 'value': None}]
    out += [{'color': c, 'value': v} for v, c in pairs[1:]]
    return {'mode': 'absolute', 'steps': out}


def color_overrides(mapping, regex=False):
    ov = []
    for name, color in (mapping.items() if isinstance(mapping, dict) else mapping):
        ov.append({'matcher': {'id': 'byRegexp' if regex else 'byName', 'options': name},
                   'properties': [{'id': 'color', 'value': {'mode': 'fixed', 'fixedColor': color}}]})
    return ov


def row(title, y):
    return {'type': 'row', 'id': nid(), 'title': title, 'collapsed': False, 'panels': [],
            'gridPos': {'x': 0, 'y': y, 'w': 24, 'h': 1}}


def stat(title, desc, targets, pos, unit, thresholds, time_from=None, calc='lastNotNull',
         decimals=None, no_value=None, color_mode='background', overrides=None):
    p = {'type': 'stat', 'id': nid(), 'title': title, 'description': desc, 'datasource': DS,
         'gridPos': pos, 'targets': targets,
         'options': {'reduceOptions': {'calcs': [calc], 'fields': '', 'values': False},
                     'colorMode': color_mode, 'graphMode': 'none', 'justifyMode': 'center',
                     'textMode': 'value_and_name', 'orientation': 'auto', 'wideLayout': True,
                     'showPercentChange': False},
         'fieldConfig': {'defaults': {'unit': unit, 'thresholds': thresholds,
                                      'color': {'mode': 'thresholds'}}, 'overrides': overrides or []}}
    if decimals is not None:
        p['fieldConfig']['defaults']['decimals'] = decimals
    if no_value is not None:
        p['fieldConfig']['defaults']['noValue'] = no_value
    if time_from:
        p['timeFrom'] = time_from
    return p


def gauge(title, desc, targets, pos, unit, thresholds, max_, time_from=None, overrides=None, interval=None):
    """Grafana 13 circular gauge, one per series, with a sparkline of the series over the panel's time range."""
    p = {'type': 'gauge', 'id': nid(), 'title': title, 'description': desc, 'datasource': DS,
         'gridPos': pos, 'targets': targets,
         'options': {'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False},
                     'shape': 'circle', 'sparkline': True, 'barShape': 'rounded', 'barWidthFactor': 0.5,
                     'endpointMarker': 'point', 'textMode': 'value_and_name', 'showThresholdMarkers': False,
                     'showThresholdLabels': False, 'sizing': 'auto', 'segmentCount': 1,
                     'effects': {'centerGlow': True, 'gradient': True, 'barGlow': False}},
         'fieldConfig': {'defaults': {'unit': unit, 'thresholds': thresholds, 'min': 0, 'max': max_,
                                      'decimals': 0, 'color': {'mode': 'thresholds'}},
                         'overrides': overrides or []}}
    if time_from:
        p['timeFrom'] = time_from
    if interval:
        p['interval'] = interval
    return p


def timeseries(title, desc, targets, pos, unit, color_mode='palette-classic-by-name',
               overrides=None, draw='line', stack=False, thresholds=None, th_style='off',
               interval=None, points='auto', min_=None, soft_max=None, legend_calcs=('mean', 'max', 'lastNotNull'),
               span_nulls=False):
    custom = {'drawStyle': draw, 'lineWidth': 2, 'fillOpacity': 80 if draw == 'bars' else 0,
              'showPoints': points, 'pointSize': 6, 'spanNulls': span_nulls,
              'stacking': {'mode': 'normal' if stack else 'none', 'group': 'A'},
              'thresholdsStyle': {'mode': th_style}, 'axisSoftMin': 0}
    if soft_max is not None:
        custom['axisSoftMax'] = soft_max
    defaults = {'unit': unit, 'color': {'mode': color_mode}, 'custom': custom}
    if thresholds:
        defaults['thresholds'] = thresholds
    if min_ is not None:
        defaults['min'] = min_
    p = {'type': 'timeseries', 'id': nid(), 'title': title, 'description': desc, 'datasource': DS,
         'gridPos': pos, 'targets': targets,
         'fieldConfig': {'defaults': defaults, 'overrides': overrides or []},
         'options': {'legend': {'displayMode': 'table', 'placement': 'bottom', 'showLegend': True,
                                'calcs': list(legend_calcs)},
                     'tooltip': {'mode': 'multi', 'sort': 'desc'}}}
    if interval:
        p['interval'] = interval
    return p


def wan(field, agg='mean'):
    return (f'SELECT {agg}("{field}") FROM "ping" WHERE {NODE} AND "address" !~ {LAN} AND $timeFilter')


def lan(field, agg='mean'):
    return (f'SELECT {agg}("{field}") FROM "ping" WHERE {NODE} AND "address" =~ {LAN} AND $timeFilter')


def expected(node, field):
    return NODE_EXPECTED.get(node, PLAN)[field]


def fmt(value):
    return f'{value:g}'


LISTED = '|'.join(re.escape(n) for n in NODE_EXPECTED)


def speed_parts(field):
    """(WHERE clause, expected value) per listed node, plus one for every other node (PLAN)."""
    parts = [(f'"computerTag" = \'{n}\'', expected(n, field)) for n in NODE_EXPECTED]
    parts.append((f'"computerTag" !~ /^({LISTED})$/' if NODE_EXPECTED else 'true', PLAN[field]))
    return parts


def below_expected(field, factor=WARN_BELOW):
    """WHERE fragment matching results under factor x each node's own expectation."""
    return '(' + ' OR '.join(f'({where} AND "{field}" < {fmt(exp * factor)})'
                             for where, exp in speed_parts(field)) + ')'


def speed_steps(exp):
    return steps('red', (round(exp * CRIT_BELOW, 6), 'orange'), (round(exp * WARN_BELOW, 6), 'green'))


GAUGE_HEADROOM = 1.2   # a gauge's full circle is 120 % of the node's expected speed


def per_node_speed_overrides(field, scale=False):
    props = lambda n: ([{'id': 'thresholds', 'value': speed_steps(expected(n, field))}] +
                       ([{'id': 'max', 'value': round(expected(n, field) * GAUGE_HEADROOM, 6)}] if scale else []))
    return [{'matcher': {'id': 'byName', 'options': n}, 'properties': props(n)} for n in NODE_EXPECTED]


EXPECTED_TEXT = ('Each node is judged against its own expected speed: ' +
                 ', '.join(f'{n} {fmt(e["download"])}/{fmt(e["upload"])}' for n, e in NODE_EXPECTED.items()) +
                 f', every other node {fmt(PLAN["download"])}/{fmt(PLAN["upload"])} Mbit/s (download/upload). '
                 f'Orange below {WARN_BELOW:.0%} of it, red below {CRIT_BELOW:.0%}.')

panels = []
y = 0

# ---------------------------------------------------------------- Now
panels.append(row('Now', y)); y += 1
LAT = steps('green', (40, 'orange'), (100, 'red'))
panels += [
    stat('Internet latency', 'Average ping to internet targets (everything except private/LAN addresses) '
         'over the last 15 minutes. Green < 40 ms, orange < 100 ms, red above.',
         [q(wan('avg') + ' GROUP BY "computerTag"', '$tag_computerTag')],
         {'x': 0, 'y': y, 'w': 6, 'h': 5}, 'ms', LAT, '15m', decimals=1),
    stat('Router latency', 'Average ping to the router (private/LAN addresses) over the last 15 minutes. '
         'High values here point at the Pi\'s Wi-Fi or cable, not the ISP. Green < 10 ms, orange < 30 ms.',
         [q(lan('avg') + ' GROUP BY "computerTag"', '$tag_computerTag')],
         {'x': 6, 'y': y, 'w': 6, 'h': 5}, 'ms', steps('green', (10, 'orange'), (30, 'red')), '15m', decimals=1),
    stat('Jitter', 'Ping variation (mdev) to internet targets over the last 15 minutes. '
         'Hurts calls and gaming. Green < 10 ms, orange < 30 ms.',
         [q(wan('mdev') + ' GROUP BY "computerTag"', '$tag_computerTag')],
         {'x': 12, 'y': y, 'w': 6, 'h': 5}, 'ms', steps('green', (10, 'orange'), (30, 'red')), '15m', decimals=1),
    stat('Packet loss', 'Average share of lost ping packets over the last 15 minutes, all targets. '
         'Any loss is orange, 5 % or more red. A target that answers nothing at all is not here but under '
         'Failures (ping exits with an error instead).',
         [q(f'SELECT mean("packetsPercent") FROM "ping" WHERE {NODE} AND $timeFilter GROUP BY "computerTag"',
            '$tag_computerTag')],
         {'x': 18, 'y': y, 'w': 6, 'h': 5}, 'percent', steps('green', (0.01, 'orange'), (5, 'red')), '15m',
         decimals=1),
]
y += 5
panels += [
    gauge('Last download', 'Most recent speed test per node (the value), with the last 24 hours of hourly tests '
          'as a sparkline. The full circle is 120 % of the node\'s expected speed. ' + EXPECTED_TEXT,
          [q(f'SELECT mean("download") FROM "speedtest" WHERE {NODE} AND $timeFilter '
             'GROUP BY time($__interval), "computerTag" fill(none)', '$tag_computerTag')],
          {'x': 0, 'y': y, 'w': 6, 'h': 7}, 'Mbits', speed_steps(PLAN['download']),
          round(PLAN['download'] * GAUGE_HEADROOM), '24h', per_node_speed_overrides('download', scale=True), '1h'),
    gauge('Last upload', 'Most recent speed test per node (the value), with the last 24 hours of hourly tests '
          'as a sparkline. The full circle is 120 % of the node\'s expected speed. ' + EXPECTED_TEXT,
          [q(f'SELECT mean("upload") FROM "speedtest" WHERE {NODE} AND $timeFilter '
             'GROUP BY time($__interval), "computerTag" fill(none)', '$tag_computerTag')],
          {'x': 6, 'y': y, 'w': 6, 'h': 7}, 'Mbits', speed_steps(PLAN['upload']),
          round(PLAN['upload'] * GAUGE_HEADROOM), '24h', per_node_speed_overrides('upload', scale=True), '1h'),
    stat('Speed tests below expected', f'How many speed tests in the selected time range measured download or '
         f'upload below {WARN_BELOW:.0%} of their node\'s expected speed, all selected nodes. ' + EXPECTED_TEXT +
         ' Details per node in the Bandwidth section.',
         [q(f'SELECT count("download") FROM "speedtest" WHERE {below_expected("download")} AND {NODE} AND $timeFilter',
            'download', 'A'),
          q(f'SELECT count("upload") FROM "speedtest" WHERE {below_expected("upload")} AND {NODE} AND $timeFilter',
            'upload', 'B')],
         {'x': 12, 'y': y, 'w': 6, 'h': 7}, 'none', steps('green', (1, 'orange'), (3, 'red')), no_value='0'),
    stat('Failures (last hour)', 'Commands that failed outright in the last hour, all selected nodes: '
         'ping with no reply at all, curl errors or timeouts (10 s), and failed speed tests.',
         [q(f'SELECT count("count") FROM "pingError" WHERE {NODE} AND $timeFilter', 'ping', 'A'),
          q(f'SELECT count("count") FROM "curlError" WHERE {NODE} AND $timeFilter', 'curl', 'B'),
          q(f'SELECT count("count") FROM "speedtest-error" WHERE {NODE} AND $timeFilter', 'speed test', 'C')],
         {'x': 18, 'y': y, 'w': 6, 'h': 7}, 'none', steps('green', (1, 'orange'), (10, 'red')), '1h',
         no_value='0'),
]
y += 7   # taller row, so the circular gauges have room
last_seen = {
    'type': 'table', 'id': nid(), 'title': 'Last report per node',
    'description': 'When each node last wrote a ping result (looks back 7 days, ignores the node filter), and how '
                   'many curl results it wrote in the last 10 minutes (about 40 when healthy). 0 (red) means the node '
                   'has stopped reporting.',
    'datasource': DS, 'gridPos': {'x': 0, 'y': y, 'w': 24, 'h': 6}, 'timeFrom': '7d',
    'targets': [q('SELECT last("avg") AS "Last ping" FROM "ping" WHERE $timeFilter GROUP BY "computerTag"',
                  '', 'A', 'table'),
                q('SELECT count("total") AS "Reports in last 10 min" FROM "curl" WHERE time > now() - 10m '
                  'GROUP BY "computerTag"', '', 'B', 'table')],
    # Join on the node: the two queries return different timestamps, so a plain merge duplicates rows.
    # The second query reads "curl" so its time column ("Time curl") can be told apart and dropped.
    'transformations': [
        {'id': 'joinByField', 'options': {'byField': 'computerTag', 'mode': 'outer'}},
        {'id': 'organize', 'options': {'excludeByName': {'Time curl': True},
                                       'renameByName': {'computerTag': 'Node', 'Time ping': 'Last report'},
                                       'indexByName': {'computerTag': 0, 'Time ping': 1, 'Reports in last 10 min': 2}}}],
    'fieldConfig': {'defaults': {'custom': {'align': 'left'}}, 'overrides': [
        {'matcher': {'id': 'byName', 'options': 'Last report'},
         'properties': [{'id': 'unit', 'value': 'dateTimeFromNow'}]},
        {'matcher': {'id': 'byName', 'options': 'Last ping'},
         'properties': [{'id': 'unit', 'value': 'ms'}, {'id': 'decimals', 'value': 1}]},
        {'matcher': {'id': 'byName', 'options': 'Reports in last 10 min'},
         'properties': [{'id': 'noValue', 'value': '0'},
                        {'id': 'thresholds', 'value': steps('red', (1, 'orange'), (30, 'green'))},
                        {'id': 'custom.cellOptions', 'value': {'type': 'color-background', 'mode': 'basic'}}]}]},
    'options': {'showHeader': True},
}
panels.append(last_seen)
y += 6

# ---------------------------------------------------------------- Latency
panels.append(row('Latency', y)); y += 1
node_ov = color_overrides(NODE_COLORS)
panels += [
    timeseries('Internet latency per node', 'Average ping to internet targets. One line per node.',
               [q(wan('avg') + ' GROUP BY time($__interval), "computerTag" fill(null)', '$tag_computerTag')],
               {'x': 0, 'y': y, 'w': 12, 'h': 8}, 'ms', overrides=node_ov),
    timeseries('Router latency per node', 'Average ping to the router. Compare with internet latency on the '
               'left: if both rise on one node, that node\'s Wi-Fi/LAN is the problem; if only internet rises '
               'everywhere, it is the ISP.',
               [q(lan('avg') + ' GROUP BY time($__interval), "computerTag" fill(null)', '$tag_computerTag')],
               {'x': 12, 'y': y, 'w': 12, 'h': 8}, 'ms', overrides=node_ov),
]
y += 8
panels += [
    timeseries('Jitter per node', 'Ping variation (mdev) to internet targets.',
               [q(wan('mdev') + ' GROUP BY time($__interval), "computerTag" fill(null)', '$tag_computerTag')],
               {'x': 0, 'y': y, 'w': 12, 'h': 8}, 'ms', overrides=node_ov),
    timeseries('Packet loss per node', 'Share of lost ping packets per 15 minutes, all targets. Total outages are '
               'not here (ping fails instead); see the status grid below.',
               [q(f'SELECT mean("packetsPercent") FROM "ping" WHERE {NODE} AND $timeFilter '
                  'GROUP BY time($__interval), "computerTag" fill(null)', '$tag_computerTag')],
               {'x': 12, 'y': y, 'w': 12, 'h': 8}, 'percent', overrides=node_ov, min_=0, interval='15m'),
]
y += 8
per_target = timeseries('Latency by target: $node', 'Average ping per target for one node. Repeated for each '
                        'selected node.',
                        [q(f'SELECT mean("avg") FROM "ping" WHERE "computerTag" =~ /^$node$/ AND {TARGET} AND '
                           '$timeFilter GROUP BY time($__interval), "address" fill(null)', '$tag_address')],
                        {'x': 0, 'y': y, 'w': 8, 'h': 11}, 'ms', overrides=color_overrides(TARGET_COLORS, True))
per_target.update({'repeat': 'node', 'repeatDirection': 'h', 'maxPerRow': 3})
panels.append(per_target)
y += 11

# ---------------------------------------------------------------- Reliability
panels.append(row('Reliability', y)); y += 1
# A failed ping writes "pingError" instead of a "ping" point, so a slice with no ping result is filled
# as 100 ("no reply"). That only shows outages at least one cell wide, hence the small cells (5 min at 24 h).
grid = {
    'type': 'status-history', 'id': nid(),
    'title': 'Reachability by node and target: green no loss · orange some loss · red heavy loss · dark red no reply',
    'description': 'Each cell is the worst packet loss in that time slice. Green: no loss. Orange: some loss. '
                   'Red: half or more lost. Dark red "no reply": no ping result at all, because the target did '
                   'not answer or the node itself stopped reporting. Cells are 5 minutes wide at 24 h, so any '
                   'outage of 5 minutes or more is visible; shorter ones show under Failures over time.',
    'datasource': DS, 'gridPos': {'x': 0, 'y': y, 'w': 24, 'h': 11}, 'interval': '2m', 'maxDataPoints': 288,
    'targets': [q(f'SELECT max("packetsPercent") FROM "ping" WHERE {NODE} AND {TARGET} AND $timeFilter '
                  'AND time < now() - 2m GROUP BY time($__interval), "computerTag", "address" fill(100)',
                  '$tag_computerTag · $tag_address')],
    'fieldConfig': {'defaults': {'unit': 'percent', 'color': {'mode': 'thresholds'},
                                 'thresholds': steps('green', (0.01, 'orange'), (50, 'red'), (100, 'dark-red')),
                                 'mappings': [
                                     {'type': 'value', 'options': {'0': {'text': 'no loss', 'color': 'green', 'index': 0}}},
                                     {'type': 'range', 'options': {'from': 0.01, 'to': 49.99,
                                                                   'result': {'text': 'some loss', 'color': 'orange', 'index': 1}}},
                                     {'type': 'range', 'options': {'from': 50, 'to': 99.99,
                                                                   'result': {'text': 'heavy loss', 'color': 'red', 'index': 2}}},
                                     {'type': 'value', 'options': {'100': {'text': 'no reply', 'color': 'dark-red', 'index': 3}}}],
                                 'custom': {'lineWidth': 1, 'fillOpacity': 80}}, 'overrides': []},
    'options': {'showValue': 'never', 'rowHeight': 0.85, 'colWidth': 0.95,
                'legend': {'showLegend': False, 'displayMode': 'list', 'placement': 'bottom'},
                'tooltip': {'mode': 'single'}},
}
panels.append(grid)
y += 11
panels += [
    timeseries('Failures over time', 'Failed commands per time slice, all selected nodes.',
               [q(f'SELECT count("count") FROM "pingError" WHERE {NODE} AND $timeFilter '
                  'GROUP BY time($__interval) fill(0)', 'ping failures', 'A'),
                q(f'SELECT count("count") FROM "curlError" WHERE {NODE} AND $timeFilter '
                  'GROUP BY time($__interval) fill(0)', 'curl failures', 'B'),
                q(f'SELECT count("count") FROM "speedtest-error" WHERE {NODE} AND $timeFilter '
                  'GROUP BY time($__interval) fill(0)', 'speed test failures', 'C')],
               {'x': 0, 'y': y, 'w': 12, 'h': 8}, 'none', overrides=color_overrides(FAILURE_COLORS),
               draw='bars', stack=True, interval='10m', legend_calcs=('sum',)),
    {
        'type': 'table', 'id': nid(), 'title': 'Failures per node', 'datasource': DS,
        'description': 'Failed commands per node in the selected time range. Nodes without failures are not listed.',
        'gridPos': {'x': 12, 'y': y, 'w': 12, 'h': 8},
        'targets': [q(f'SELECT count("count") AS "Ping" FROM "pingError" WHERE {NODE} AND $timeFilter '
                      'GROUP BY "computerTag"', '', 'A', 'table'),
                    q(f'SELECT count("count") AS "Curl" FROM "curlError" WHERE {NODE} AND $timeFilter '
                      'GROUP BY "computerTag"', '', 'B', 'table'),
                    q(f'SELECT count("count") AS "Speed test" FROM "speedtest-error" WHERE {NODE} AND $timeFilter '
                      'GROUP BY "computerTag"', '', 'C', 'table')],
        'transformations': [{'id': 'merge', 'options': {}},
                            {'id': 'organize', 'options': {'excludeByName': {'Time': True},
                                                           'renameByName': {'computerTag': 'Node'},
                                                           'indexByName': {'computerTag': 0}}}],
        'fieldConfig': {'defaults': {'noValue': '0', 'thresholds': steps('green', (1, 'orange'), (10, 'red')),
                                     'custom': {'align': 'left', 'cellOptions': {'type': 'color-text'}}},
                        'overrides': [{'matcher': {'id': 'byName', 'options': 'Node'},
                                       'properties': [{'id': 'custom.cellOptions', 'value': {'type': 'auto'}}]}]},
        'options': {'showHeader': True},
    },
]
y += 8

# ---------------------------------------------------------------- Web response
panels.append(row('Web response (curl)', y)); y += 1
per_url = timeseries('Page load time by URL: $node', 'Total time to fetch each URL (DNS + connect + TLS + '
                     'server + transfer) for one node. Repeated for each selected node.',
                     [q('SELECT mean("total") * 1000 FROM "curl" WHERE "computerTag" =~ /^$node$/ AND $timeFilter '
                        'GROUP BY time($__interval), "address" fill(null)', '$tag_address')],
                     {'x': 0, 'y': y, 'w': 8, 'h': 10}, 'ms', overrides=color_overrides(TARGET_COLORS, True))
per_url.update({'repeat': 'node', 'repeatDirection': 'h', 'maxPerRow': 3})
panels.append(per_url)
y += 10
phase_names = ['DNS', 'Connect', 'TLS', 'Server wait', 'Transfer']
panels += [
    {
        # curl timings are cumulative. Split at pretransfer, not appconnect: appconnect is 0 for plain HTTP.
        'type': 'barchart', 'id': nid(), 'title': 'Where page-load time goes', 'datasource': DS,
        'description': 'Average time per phase of fetching each URL, selected nodes and time range. '
                       'DNS: name lookup. Connect: TCP. TLS: encryption handshake (≈0 for plain HTTP). '
                       'Server wait: until the first byte. Transfer: rest of the page. '
                       'Needs service version with the extended curl timings.',
        'gridPos': {'x': 0, 'y': y, 'w': 12, 'h': 8},
        'targets': [q('SELECT mean("namelookup") * 1000 AS "DNS", '
                      '(mean("connect") - mean("namelookup")) * 1000 AS "Connect", '
                      '(mean("pretransfer") - mean("connect")) * 1000 AS "TLS", '
                      '(mean("starttransfer") - mean("pretransfer")) * 1000 AS "Server wait", '
                      '(mean("total") - mean("starttransfer")) * 1000 AS "Transfer" '
                      f'FROM "curl" WHERE {NODE} AND "connect" > 0 AND $timeFilter GROUP BY "address"',
                      '', 'A', 'table')],
        'transformations': [{'id': 'organize', 'options': {'excludeByName': {'Time': True},
                                                           'indexByName': {'address': 0}}}],
        'fieldConfig': {'defaults': {'unit': 'ms', 'color': {'mode': 'fixed'},
                                     'custom': {'fillOpacity': 90, 'lineWidth': 0}},
                        'overrides': color_overrides(dict(zip(phase_names, PHASE_COLORS)))},
        'options': {'orientation': 'horizontal', 'stacking': 'normal', 'xField': 'address',
                    'showValue': 'never', 'barWidth': 0.7, 'groupWidth': 0.7,
                    'legend': {'showLegend': True, 'displayMode': 'list', 'placement': 'bottom'},
                    'tooltip': {'mode': 'multi'}},
    },
    timeseries('DNS lookup time per node', 'Average name-lookup time across URLs. Slow DNS makes everything '
               'feel slow even when bandwidth is fine.',
               [q(f'SELECT mean("namelookup") * 1000 FROM "curl" WHERE {NODE} AND $timeFilter '
                  'GROUP BY time($__interval), "computerTag" fill(null)', '$tag_computerTag')],
               {'x': 12, 'y': y, 'w': 12, 'h': 8}, 'ms', overrides=node_ov),
]
y += 8

# ---------------------------------------------------------------- Bandwidth
panels.append(row('Bandwidth (speed test)', y)); y += 1
# Grafana can't color one chart per node, so the % charts divide each node by its own expectation
# in the query (one query per listed node, one for all others) and share the same bands.
pct_bands = steps('red', (CRIT_BELOW * 100, 'orange'), (WARN_BELOW * 100, 'transparent'))


def pct_chart(field, title, x):
    return timeseries(
        f'{title}, % of expected per node',
        f'Speed test results (hourly) as a share of each node\'s expected {field} speed, so all nodes compare on '
        f'one scale. Orange band: below {WARN_BELOW:.0%}. Red band: below {CRIT_BELOW:.0%}. ' + EXPECTED_TEXT,
        [q(f'SELECT mean("{field}") / {fmt(exp)} * 100 FROM "speedtest" WHERE {where} AND {NODE} AND $timeFilter '
           'GROUP BY time($__interval), "computerTag" fill(none)', '$tag_computerTag', chr(65 + i))
         for i, (where, exp) in enumerate(speed_parts(field))],
        {'x': x, 'y': y, 'w': 12, 'h': 9}, 'percent', overrides=node_ov, thresholds=pct_bands,
        th_style='line+area', points='always', min_=0, soft_max=110, span_nulls=True,
        legend_calcs=('lastNotNull', 'mean', 'min'))


def raw_chart(field, title, x):
    return timeseries(
        f'{title} per node', f'Speed test results (hourly) in Mbit/s. ' + EXPECTED_TEXT,
        [q(f'SELECT mean("{field}") FROM "speedtest" WHERE {NODE} AND $timeFilter '
           'GROUP BY time($__interval), "computerTag" fill(none)', '$tag_computerTag')],
        {'x': x, 'y': y, 'w': 12, 'h': 8}, 'Mbits', overrides=node_ov, points='always', min_=0, span_nulls=True,
        legend_calcs=('lastNotNull', 'mean', 'min'))


panels += [pct_chart('download', 'Download', 0), pct_chart('upload', 'Upload', 12)]
y += 9
panels += [raw_chart('download', 'Download', 0), raw_chart('upload', 'Upload', 12)]
y += 8

# Table: one stats query per listed node plus one for the others (each divides by its own
# expectation), and the below-expected counts; merged into one row per node.
# Short column names (DL/UL) keep all 12 columns visible at full width.
pct_cols = [f'{f} {c} %' for f in ('DL', 'UL') for c in ('avg', 'min')]
speed_ov = [{'matcher': {'id': 'byName', 'options': col},
             'properties': [{'id': 'unit', 'value': 'percent'}, {'id': 'decimals', 'value': 0},
                            {'id': 'thresholds', 'value': speed_steps(100)},
                            {'id': 'custom.cellOptions', 'value': {'type': 'color-text'}}]} for col in pct_cols]
speed_ov += [{'matcher': {'id': 'byRegexp', 'options': '(DL|UL) (expected|last)'},
              'properties': [{'id': 'unit', 'value': 'Mbits'}, {'id': 'decimals', 'value': 0}]}]
# Grafana anchors byRegexp to the whole column name.
speed_ov += [{'matcher': {'id': 'byRegexp', 'options': '(DL|UL) below'},
              'properties': [{'id': 'noValue', 'value': '0'},
                             {'id': 'thresholds', 'value': steps('green', (1, 'orange'), (3, 'red'))},
                             {'id': 'custom.cellOptions', 'value': {'type': 'color-background', 'mode': 'basic'}}]}]


def table_stats(i, where, exp_down, exp_up):
    def pct(agg, field, exp):
        return f'{agg}("{field}") / {fmt(exp)} * 100'
    return q(f'SELECT count("download") AS "Tests", '
             f'{fmt(exp_down)} + 0 * last("download") AS "DL expected", '
             f'last("download") AS "DL last", '
             f'{pct("mean", "download", exp_down)} AS "DL avg %", '
             f'{pct("min", "download", exp_down)} AS "DL min %", '
             f'{fmt(exp_up)} + 0 * last("upload") AS "UL expected", '
             f'last("upload") AS "UL last", '
             f'{pct("mean", "upload", exp_up)} AS "UL avg %", '
             f'{pct("min", "upload", exp_up)} AS "UL min %" '
             f'FROM "speedtest" WHERE {where} AND {NODE} AND $timeFilter GROUP BY "computerTag"',
             '', chr(65 + i), 'table')


down_parts, up_parts = speed_parts('download'), speed_parts('upload')
table_targets = [table_stats(i, where, exp_down, up_parts[i][1])
                 for i, (where, exp_down) in enumerate(down_parts)]
n = len(table_targets)
table_targets += [
    q(f'SELECT count("download") AS "DL below" FROM "speedtest" WHERE {below_expected("download")} '
      f'AND {NODE} AND $timeFilter GROUP BY "computerTag"', '', chr(65 + n), 'table'),
    q(f'SELECT count("upload") AS "UL below" FROM "speedtest" WHERE {below_expected("upload")} '
      f'AND {NODE} AND $timeFilter GROUP BY "computerTag"', '', chr(66 + n), 'table'),
]
panels += [
    {
        'type': 'table', 'id': nid(), 'title': 'Speed vs expected per node', 'datasource': DS,
        'description': 'Speed test summary for the selected time range. DL = download, UL = upload. '
                       '"expected" and "last" are Mbit/s; "avg %" and "min %" are a share of the node\'s expected '
                       'speed; "below" counts tests under ' + f'{WARN_BELOW:.0%}' + ' of it. ' + EXPECTED_TEXT,
        'gridPos': {'x': 0, 'y': y, 'w': 24, 'h': 6},
        'targets': table_targets,
        'transformations': [{'id': 'merge', 'options': {}},
                            {'id': 'organize', 'options': {'excludeByName': {'Time': True},
                                                           'renameByName': {'computerTag': 'Node'},
                                                           'indexByName': {'computerTag': 0, 'Tests': 1, 'DL expected': 2, 'DL last': 3, 'DL avg %': 4, 'DL min %': 5, 'DL below': 6, 'UL expected': 7, 'UL last': 8, 'UL avg %': 9, 'UL min %': 10, 'UL below': 11}}}],
        'fieldConfig': {'defaults': {'custom': {'align': 'left', 'minWidth': 70}}, 'overrides': speed_ov},
        'options': {'showHeader': True},
    },
    timeseries('Speed test ping per node', 'Latency measured by the speed test itself, to its test server. '
               'Needs service version with the extended speed test parsing.',
               [q(f'SELECT mean("ping") FROM "speedtest" WHERE {NODE} AND $timeFilter '
                  'GROUP BY time($__interval), "computerTag" fill(none)', '$tag_computerTag')],
               {'x': 0, 'y': y + 6, 'w': 24, 'h': 7}, 'ms', overrides=node_ov, points='always', span_nulls=True,
               legend_calcs=('lastNotNull',)),
]
y += 13

# ---------------------------------------------------------------- Click to filter
# Grafana's native cross-filtering needs "Group by", which InfluxDB doesn't support, and our queries are
# raw InfluxQL. Data links do the same job through our own $node/$target variables: a click on a node's
# tile, line, grid cell or table row reloads this dashboard for that node, keeping the time range.
TIME = '${__url_time_range}'
LINK_NODE = {'title': 'Show only ${__field.labels.computerTag}', 'targetBlank': False,
             'url': f'/d/{UID}/?orgId=1&var-node=${{__field.labels.computerTag}}&${{target:queryparam}}&{TIME}'}
LINK_NODE_TARGET = {'title': 'Show only ${__field.labels.computerTag} → ${__field.labels.address}',
                    'targetBlank': False,
                    'url': f'/d/{UID}/?orgId=1&var-node=${{__field.labels.computerTag}}'
                           f'&var-target=${{__field.labels.address}}&{TIME}'}
LINK_TARGET = {'title': 'Show only target ${__field.labels.address}', 'targetBlank': False,
               'url': f'/d/{UID}/?orgId=1&${{node:queryparam}}&var-target=${{__field.labels.address}}&{TIME}'}
LINK_TABLE_NODE = {'title': 'Show only ${__value.raw}', 'targetBlank': False,
                   'url': f'/d/{UID}/?orgId=1&var-node=${{__value.raw}}&${{target:queryparam}}&{TIME}'}


def group_by_sources(panel):
    return ' '.join(t.get('query', '') for t in panel.get('targets', []))


def add_links(panel):
    group_by = ' '.join(t.get('query', '').split('GROUP BY')[1] for t in panel.get('targets', [])
                        if 'GROUP BY' in t.get('query', ''))
    by_node, by_address = '"computerTag"' in group_by, '"address"' in group_by
    defaults = panel.get('fieldConfig', {}).get('defaults')
    if panel['type'] == 'table':
        node_col = [o for o in panel['fieldConfig']['overrides'] if o['matcher'].get('options') == 'Node']
        if not node_col:
            node_col = [{'matcher': {'id': 'byName', 'options': 'Node'}, 'properties': []}]
            panel['fieldConfig']['overrides'].append(node_col[0])
        node_col[0]['properties'].append({'id': 'links', 'value': [LINK_TABLE_NODE]})
    elif defaults is None or panel['type'] == 'barchart':
        return
    elif by_node and by_address:
        defaults['links'] = [LINK_NODE_TARGET]
    elif by_address and '"curl"' not in group_by_sources(panel):
        defaults['links'] = [LINK_TARGET]    # ping targets only: curl addresses are URLs, not $target values
    elif by_node:
        defaults['links'] = [LINK_NODE]


for panel in panels:
    if panel['type'] != 'row':
        add_links(panel)

var = lambda name, label, query: {
    'type': 'query', 'name': name, 'label': label, 'datasource': DS, 'query': query,
    'multi': True, 'includeAll': True, 'refresh': 2, 'sort': 1,
    'current': {'selected': True, 'text': ['All'], 'value': ['$__all']}, 'options': [], 'hide': 0}

dashboard = {
    'uid': UID, 'id': None, 'title': f'Network health v{VERSION}',
    'description': 'Per-node network health: latency, reachability, web response and bandwidth vs each node\'s expected speed.',
    'tags': ['smart-home', f'v{VERSION}'], 'editable': True, 'graphTooltip': 1, 'schemaVersion': 39,
    'time': {'from': 'now-24h', 'to': 'now'}, 'refresh': '1m', 'timezone': '', 'version': 1,
    'links': [{'type': 'link', 'title': 'All nodes and targets', 'icon': 'dashboard', 'keepTime': True,
               'url': f'/d/{UID}/?orgId=1&var-node=$__all&var-target=$__all', 'includeVars': False,
               'asDropdown': False, 'targetBlank': False, 'tags': []},
              {'type': 'dashboards', 'tags': ['smart-home'], 'asDropdown': False, 'title': 'Dashboards',
               'includeVars': False, 'keepTime': True}],
    'templating': {'list': [
        var('node', 'Node', 'SHOW TAG VALUES FROM "ping" WITH KEY = "computerTag"'),
        var('target', 'Ping target', 'SHOW TAG VALUES FROM "ping" WITH KEY = "address" WHERE "computerTag" =~ /^$node$/'),
    ]},
    'annotations': {'list': []},
    'panels': panels,
}

out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUTPUT
out.write_text(json.dumps(dashboard, indent=2) + '\n')
print(f'Wrote {out} ({len(panels)} panels)')
