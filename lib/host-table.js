'use strict';

const
    utils = require('./utils');


/**
 * HostTable Object constructor
 *
 * @constructor
 * @memberof HostTable
 * @param {object} src - Source data for hosts.
 * @param {object} config - Config object.
 * @param {object} config.env - Environment object
 * @param {object} [config.env.subs] - Environment object containing substitutions
 * @param {object} [config.log] - Shared logger, if used.
 * @param {object} config.routeTables - The route tables object
 */
function HostTable(src, config) {
    let
        routeTables,
        subs = null;

    // Initialize values
    this.count = 0;
    this.hasDefaultHost = false;
    this.hosts = {};

    // Validate host table source object
    if (!Array.isArray(src) || src.length === 0) {
        throw new Error('Invalid or empty host table source data!');
    }

    // Validate config object
    if (typeof config !== 'object' || config === null ||
        typeof config.routeTables !== 'object' || config.routeTables === null) {

        throw new Error('Invalid or empty host table config!');
    }
    this.log = config.log || utils.baseLogger;
    routeTables = config.routeTables;
    subs = (config.env && config.env.subs) || null;

    // Check each host table entry
    for (let h, hc, i = 0, rr; i < src.length; i++) {
        try {
            h = src[i];
            if (typeof h !== 'object' || h === null ||
                !Array.isArray(h.hostnames) || h.hostnames.length === 0 ||
                !Array.isArray(h.routeTables) || h.routeTables.length === 0) {

                throw new Error('Invalid or empty host table entry!');
            }

            hc = {};
            // Get host connection timeout, if set
            hc.timeout = (typeof h.timeout === 'number') ? h.timeout :
                (typeof config.defaults.timeout === 'number' ? config.defaults.timeout : 0);

            // Pull together the headers, proxy headers, and redirect headers for each host
            if ((typeof config.defaults.headers === 'object' && config.defaults.headers !== null) ||
                (typeof h.headers === 'object' && h.headers !== null)) {

                hc.headers = utils.mergeHeaders(config.defaults.headers, h.headers);
            } else {
                hc.headers = null;
            }
            if ((typeof config.defaults.proxyHeaders === 'object' && config.defaults.proxyHeaders !== null) ||
                (typeof h.proxyHeaders === 'object' && h.proxyHeaders !== null)) {

                hc.proxyHeaders = utils.mergeHeaders(config.defaults.proxyHeaders, h.proxyHeaders);
            } else {
                hc.proxyHeaders = null;
            }
            if ((typeof config.defaults.redirectHeaders === 'object' && config.defaults.redirectHeaders !== null) ||
                (typeof h.redirectHeaders === 'object' && h.redirectHeaders !== null)) {

                hc.redirectHeaders = utils.mergeHeaders(config.defaults.redirectHeaders, h.redirectHeaders);
            } else {
                hc.redirectHeaders = null;
            }

            // Check for route tables that match the requested ID
            rr = [];
            for (let j = 0, r; j < h.routeTables.length; j++) {
                r = h.routeTables[j];
                if (typeof r !== 'string' || r.length === 0 ||
                    typeof routeTables[r] !== 'object' || routeTables[r] === null) {

                    throw new Error('Invalid or undefined route table!');
                }
                rr.push(routeTables[r].getResolver());
            }

            // Check the hostname list
            for (let n, k = 0; k < h.hostnames.length; k++) {
                n = h.hostnames[k];

                // Deal with substitution strings...
                if (subs !== null) {
                    n = utils.substitute(n, subs);
                    // If resulting hostname is blank, skip this one...
                    if (n === '') {
                        continue;
                    }
                }

                // Verify hostname is valid
                if (!utils.isHostnameValid(n) && n !== '*') {
                    throw new Error(`Invalid hostname "${n}"!`);
                }

                n = n.toLowerCase();
                if (Array.isArray(this.hosts[n]) && this.hosts[n].length !== 0) {
                    throw new Error(`Multiple host table entries for hostname "${n}"!`);
                }

                this.hosts[n] = {
                    config: hc,
                    routeResolvers: rr
                };

                if (n === '*') {
                    this.hasDefaultHost = true;
                }
                this.count++;
            }
        } catch (err) {
            throw new Error(`Error in host table entry #${i}: ` + (err.message || 'Unknown'));
        }
    }
}


/**
 * Retrieve the host object
 *
 * @memberof HostTable
 * @public
 * @param {string} host - The hostname to use
 * @returns {object} - The host object for the hostname
 */
HostTable.prototype.getHost = function (host) {
    let hn = (typeof host === 'string' && host.length !== 0) ? host.toLowerCase() : '*';

    // If we have a match, return it
    if (typeof this.hosts[hn] === 'object' && this.hosts[hn] !== null) {
        return this.hosts[hn];
    }

    // No matching host, if we have a default, return that.
    if (this.hasDefaultHost === true) {
        return this.hosts['*'];
    }

    // Host not found and no default set
    return null;
};


module.exports = HostTable;

