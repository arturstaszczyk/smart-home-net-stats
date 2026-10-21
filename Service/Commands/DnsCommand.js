import _ from 'lodash'
import { randomBytes } from 'crypto'
import BaseCommand from './BaseCommand.js'

// Defaults only; index.js passes the values from DNS_CACHED_NAME / DNS_UNCACHED_DOMAIN.
export const DEFAULT_CACHED_NAME = 'google.com'
export const DEFAULT_UNCACHED_DOMAIN = 'example.com'

// NXDOMAIN is a valid answer: a random name doesn't exist.
const ANSWER_STATUSES = ['NOERROR', 'NXDOMAIN']
const SAFE_SERVER = /^[0-9A-Za-z.:-]+$/
const SAFE_RESOLVER = /^[a-z0-9-]+$/
const SAFE_DOMAIN = /^[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)+$/

export const isSafeDomain = (value) => SAFE_DOMAIN.test(`${value || ''}`)

// "pihole=10.0.0.53,public=1.1.1.1" -> [{ resolver: 'pihole', server: '10.0.0.53' }, ...]
// Entries with an unsafe name or address are skipped, so nothing unexpected reaches the shell.
export const parseDnsServers = (value) => _.compact(_.map(`${value || ''}`.split(','), (entry) => {
    const [resolver, server] = _.map(entry.split('='), _.trim)
    return SAFE_RESOLVER.test(resolver || '') && SAFE_SERVER.test(server || '') ? { resolver, server } : null
}))

export default class DnsCommand extends BaseCommand {

    // Parses `dig` output. status is null when no server answered (dig prints no header then).
    parseOutput(stdout) {
        const status = stdout.match(/status: ([A-Z]+)/)
        const queryTime = stdout.match(/Query time: ([0-9]+) msec/)

        return {
            status: status ? status[1] : null,
            queryTime: queryTime ? Number(queryTime[1]) : null,
        }
    }

    // "cached" asks for a name every resolver has cached: it measures the path to the resolver.
    // "uncached" asks for a new random name under uncachedDomain, so a local resolver (Pi-hole,
    // router) must ask further; large public resolvers can still answer it from cached signed records.
    // No server = the node's normal resolver (/etc/resolv.conf), which is what applications use.
    buildCommand(options) {
        const cachedName = isSafeDomain(options.cachedName) ? options.cachedName : DEFAULT_CACHED_NAME
        const uncachedDomain = isSafeDomain(options.uncachedDomain) ? options.uncachedDomain : DEFAULT_UNCACHED_DOMAIN
        const name = options.query === 'uncached'
            ? `smarthome-${randomBytes(6).toString('hex')}.${uncachedDomain}`
            : cachedName
        const server = SAFE_SERVER.test(`${options.server || ''}`) ? `@${options.server} ` : ''

        return `dig ${server}${name} +tries=1 +time=2`
    }

    execute(options) {
        const commandName = 'DNS'
        const resolver = options.resolver || 'system'
        const query = options.query === 'uncached' ? 'uncached' : 'cached'
        const computerTag = options.computerTag || 'UNKNOWN'

        console.log(`Command ${commandName}: ${resolver} (${options.server || 'system resolver'}), ${query}`)

        return new Promise((resolve, reject) => {

            const tags = { resolver, query, computerTag }
            const metrics = {}
            let metricName = ''

            const fail = (reason) => {
                metricName = 'dnsError'
                _.assign(tags, { error: reason })
                _.assign(metrics, { count: '1' })
                console.log(`${commandName} error for ${resolver} (${query}): ${reason}`)
            }

            super._execute(this.buildCommand({ ...options, query }), commandName, {
                onSuccess: (stdout) => {
                    const { status, queryTime } = this.parseOutput(stdout)

                    if (_.includes(ANSWER_STATUSES, status) && queryTime !== null) {
                        metricName = 'dns'
                        _.assign(metrics, { queryTime })
                        console.log(`Found ${commandName} metrics for ${resolver} (${query})`)
                        console.log(metrics)
                    } else {
                        // dig exits 0 for a resolver error such as SERVFAIL
                        fail(status ? status.toLowerCase() : 'no reply')
                    }
                },
                // dig exits non-zero (9) when no server replied at all
                onError: () => fail('no reply'),
                onClose: (error) => {
                    const dnsResults = { metricName, metrics, tags }
                    if (error) {
                        reject(dnsResults)
                    } else {
                        resolve(dnsResults)
                    }
                }
            }, {
                timeout: 10000
            })
        })
    }
}
