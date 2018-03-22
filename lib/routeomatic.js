/**
 * Route-o-matic -- A festival of routing, redirecting, and rewriting joy for ExpressJS.
 */

'use strict';

const
    defaultAllowWrite = false,
    defaultNormalizeUrls = false,
    defaultRedirectCode = 302,
    defaultReduceRedirectCode = 301,
    defaultRetryLimit = 20,
    defaultRemoveDoubleSlashes = false,
    defaultTimeout = 20000,
    HostTable = require('./host-table'),
    RomRequest = require('./rom-request'),
    RouteTable = require('./route-table'),
    utils = require('./utils');


/**
 * RouteOMatic object constructor
 *
 * @constructor
 * @param {object} envConf - Environment configuration object
 * @param {object} [envConf.env] - Environment configuration current settings object, optional
 * @param {object} [envConf.env.conds] - Environment configuration conditionals object, optional
 * @param {object} [envConf.env.subs] - Environment configuration substitutions object, optional
 * @param {object} envConf.routeHandlers - Route handlers namespace object
 * @param {object} [envConf.logger] - Shared logger object, optional
 * @param {object} [envConf.requestLogger] - Shared logger object for use in request logging, optional
 * @param {object} [envConf.onSent] - Post response sent function, optional
 * @param {object} hostConf - Host configuration object
 * @param {object} hostConf.defaults - Default host settings object
 * @param {object} [hostConf.defaults.headers] - Default header values, optional
 * @param {array} hostConf.hosts - Array of host config objects
 * @param {array} hostConf.routeTables - Array of route tables config objects
 * @param {object|function} server - Server object (top-level Express object or function)
 */
function RouteOMatic(envConf, hostConf, server) {
    // Initialize object values
    this.hostTable = {};
    this.log = envConf.logger || utils.baseLogger;
    this.logReq = envConf.requestLogger || this.log;
    this.valid = false;

    // Verify server and name parameters
    if (typeof envConf !== 'object' || envConf === null) {
        throw new Error('Invalid environment config object!');
    }
    if (server === null || (typeof server !== 'object' && typeof server !== 'function')) {
        throw new Error('Invalid server object!' + typeof server);
    }

    // Process the hosts, routes, and config
    this.hostTable = this.setupAllTheThings(envConf, hostConf);

    // We have something, so attach it the server
    this.valid = true;
    server.all('*', this.handleRouting.bind(this));
}


/**
 * Check to see if this RouteOMatic instance is "valid".
 *
 * @memberof RouteOMatic
 * @public
 * @returns {boolean} - true if valid, false if not valid
 */
RouteOMatic.prototype.isValid = function () {
    return this.valid;
};


/**
 * Get the currently active host table
 *
 * @memberof RouteOMatic
 * @public
 * @returns {object} - The host table object
 */
RouteOMatic.prototype.getHostTable = function () {
    return this.hostTable;
};


/**
 * Setup all the things!
 *
 * @memberof RouteOMatic
 * @private
 * @param {object} envConf - Environment configuration object
 * @param {object} hostConf - Host configuration object
 * @returns {object} - New host table object
 * @throws {Error} - Throws error on failure
 */
RouteOMatic.prototype.setupAllTheThings = function (envConf, hostConf) {
    let config,
        hostTable = {},
        reqSettings = {},
        routeTables = {};

    // Process the environment config object
    try {
        if (typeof envConf !== 'object' || envConf === null) {
            throw new Error('Invalid or empty configuration');
        }
        if (typeof envConf.routeHandlers !== 'object' || envConf.routeHandlers === null) {
            throw new Error('Invalid route handler context object');
        }
        config = {
            routeHandlers: envConf.routeHandlers
        };
        if (typeof envConf.env !== 'undefined') {
            if (envConf.env === null || typeof envConf.env !== 'object') {
                throw new Error('Invalid current environment settings object');
            }
            config.env = envConf.env;
        }
        if (typeof envConf.logger !== 'undefined') {
            if (envConf.logger === null || typeof envConf.logger !== 'object') {
                throw new Error('Invalid logger object');
            }
            config.log = envConf.logger;
        }
        if (typeof envConf.requestLogger !== 'undefined') {
            if (envConf.requestLogger === null || typeof envConf.requestLogger !== 'object') {
                throw new Error('Invalid requestLogger object');
            }
            reqSettings.requestLogger = envConf.requestLogger;
        }
        if (typeof envConf.dnsLookup !== 'undefined') {
            if (envConf.dnsLookup === null || typeof envConf.dnsLookup !== 'function') {
                throw new Error('Invalid DNS lookup object');
            }
            config.dnsLookup = envConf.dnsLookup;
        }
        if (typeof envConf.onSent === 'function') {
            reqSettings.onSent = envConf.onSent;
        } else {
            reqSettings.onSent = null;
        }
        reqSettings.ports = {};
        if (typeof envConf.ports === 'object' && envConf.ports !== null) {
            let i,
                k = Object.keys(envConf.ports),
                p,
                ps;

            for (i = 0; i < k.length; i++) {
                if (typeof k[i] === 'string') {
                    p = parseInt(k[i], 10);
                } else if (typeof k[i] === 'number') {
                    p = k[i];
                } else {
                    p = 0;
                }
                if (p > 0 && p < 65536) {
                    ps = p.toString(10);
                    if (envConf.ports[k[i]].origProto !== 'http' && envConf.ports[k[i]].origProto !== 'https') {
                        throw new Error(`Invalid protocol specified for port ${k[i]}`);
                    }
                    reqSettings.ports[ps] = {
                        portNumber: p,
                        origProto: envConf.ports[k[i]].origProto,
                        origProtoVer: envConf.ports[k[i]].origProtoVer || '1.1'
                    };
                    if (typeof envConf.ports[k[i]].origPort !== 'undefined') {
                        if (typeof envConf.ports[k[i]].origPort !== 'number') {
                            throw new Error(`Invalid original port specified for port ${k[i]}`);
                        }
                        reqSettings.ports[ps].origPortNumber = envConf.ports[k[i]].origPort;
                        reqSettings.ports[ps].origPort = envConf.ports[k[i]].origPort.toString(10);
                    } else {
                        reqSettings.ports[ps].origPortNumber = p;
                        reqSettings.ports[ps].origPort = ps;
                    }
                }
            }
        }
    } catch (err) {
        throw new Error(`Error processing Route-O-Matic environment configuration: ${err.message}`);
    }

    // Process the host config object
    try {
        if (typeof hostConf !== 'object' || hostConf === null) {
            throw new Error('Invalid or empty configuration!');
        }
        if (typeof hostConf.defaults !== 'undefined' && (typeof hostConf.defaults !== 'object' || hostConf.defaults === null)) {
            throw new Error('Invalid default host settings object!');
        }
        if (!Array.isArray(hostConf.hosts) || hostConf.hosts.length === 0) {
            throw new Error('Invalid or empty hosts configuration!');
        }
        if (typeof hostConf.routeTables !== 'object' || hostConf.routeTables === null) {
            throw new Error('Invalid or empty route table configuration!');
        }
        config.defaults = hostConf.defaults || {};
        // Set any unset defaults
        if (typeof config.defaults.allowWrite !== 'boolean') {
            config.defaults.allowWrite = defaultAllowWrite;
        }
        if (typeof config.defaults.normalizeUrls !== 'boolean') {
            config.defaults.normalizeUrls = defaultNormalizeUrls;
        }
        if (typeof config.defaults.redirectCode !== 'number') {
            config.defaults.redirectCode = defaultRedirectCode;
        }
        if (typeof config.defaults.reduceRedirectCode !== 'number') {
            config.defaults.reduceRedirectCode = defaultReduceRedirectCode;
        }
        if (typeof config.defaults.removeDoubleSlashed !== 'boolean') {
            config.defaults.removeDoubleSlashes = defaultRemoveDoubleSlashes;
        }
        if (typeof config.defaults.retryLimit !== 'number') {
            config.defaults.retryLimit = defaultRetryLimit;
        }
        if (typeof config.defaults.timeout !== 'number') {
            config.defaults.timeout = defaultTimeout;
        }
    } catch (err) {
        throw new Error(`Error processing Route-O-Matic configuration: ${err.message}`);
    }
    reqSettings.allowWrite = config.defaults.allowWrite;
    reqSettings.dnsLookup = config.dnsLookup || null;
    reqSettings.normalizeUrls = config.defaults.normalizeUrls;
    reqSettings.redirectCode = config.defaults.redirectCode;
    reqSettings.reduceRedirectCode = config.defaults.reduceRedirectCode;
    reqSettings.removeDoubleSlashes = config.defaults.removeDoubleSlashes;
    reqSettings.requestLogger = this.logReq;
    reqSettings.retryLimit = config.defaults.retryLimit;
    reqSettings.timeout = config.defaults.timeout;

    // Process the route table objects
    try {
        for (let rt in hostConf.routeTables) {
            if (hostConf.routeTables.hasOwnProperty(rt)) {
                if (typeof hostConf.routeTables[rt] !== 'object' || hostConf.routeTables[rt] === null) {
                    throw new Error(`Bad route table configuration (${rt})`);
                }
                hostConf.routeTables[rt].id = rt;

                try {
                    routeTables[rt] = new RouteTable(hostConf.routeTables[rt], config);
                } catch (e) {
                    throw new Error(`Failure processing route table "${rt}": ${e.message}`);
                }
            }
        }
    } catch (err) {
        throw new Error(`Error processing Route-O-Matic route tables: ${err.message}`);
    }
    config.routeTables = routeTables;

    // Process the host objects
    try {
        hostTable = new HostTable(hostConf.hosts, config);
    } catch (err) {
        throw new Error(`Error processing Route-O-Matic host table: ${err.message}`);
    }

    // Successfully setup new routes and hosts
    this.reqSettings = reqSettings;
    this.reqSettings.hostTable = hostTable;
    this.log.debug('Successfully updated hosts and route tables.');
    return hostTable;
};


/**
 * Re-configure with new hosts/routes/settings
 *
 * @memberof RouteOMatic
 * @public
 * @param {object} newEnvConf - New environment configuration object
 * @param {object} newHostConf - New host configuration object
 * @returns {boolean} - true if successful, false if not
 */
RouteOMatic.prototype.reconfigure = function (newEnvConf, newHostConf) {
    try {
        let newHostTable;

        if (typeof newEnvConf !== 'object' || newEnvConf === null) {
            throw new Error('Invalid environment config object!');
        }

        // Try to re-configure with the new settings
        newHostTable = this.setupAllTheThings(newEnvConf, newHostConf);

        if (newHostTable) {
            delete this.hostTable;
            this.hostTable = newHostTable;
            this.valid = true;
            return true;
        }
    } catch (err) {
        this.log.error(`Failed to reconfigure the routes: ${err.message}`);
    }

    return false;
};


/**
 * Handle ExpressJS routing with the Route-O-Matic
 *
 * @memberof RouteOMatic
 * @public
 * @param {object} req - Request object (Express)
 * @param {object} res - Response object (HTTP/HTTPS)
 * @param {function} [next] - Continuation function
 */
RouteOMatic.prototype.handleRouting = function (req, res, next) {
    let romReq = new RomRequest(this.reqSettings);

    romReq.process(req, res, next);
};


module.exports = RouteOMatic;

