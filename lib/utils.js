'use strict';

const
    methods = ['GET', 'HEAD', 'POST', 'PUT', 'CHECKOUT', 'COPY', 'DELETE',
        'LOCK', 'MERGE', 'MKACTIVITY', 'MKCOL', 'MOVE', 'M-SEARCH', 'NOTIFY',
        'OPTIONS', 'PATCH', 'PURGE', 'REPORT', 'SEARCH', 'SUBSCRIBE',
        'TRACE', 'UNLOCK', 'UNSUBSCRIBE'],
    writeMethods = ['POST', 'PUT', 'DELETE', 'LOCK', 'MERGE', 'MKACTIVITY',
        'MKCOL', 'MOVE', 'PATCH', 'PURGE', 'UNLOCK', 'UNSUBSCRIBE'];

var utils;


/**
 * Empty function to use with baseLogger
 *
 * @function
 * @private
 * @param {string} _msg - Message to log
 */
function emptyFunc(_msg) {
}


/**
 * Utils module
 *
 * @module utils
 */
utils = {
    /**
     * Basic logging to use if nothing else is defined.
     *
     * @object
     * @public
     */
    baseLogger: {
        debug: emptyFunc,
        error: emptyFunc,
        fatal: function (msg) { console.log(msg); },
        info: emptyFunc,
        warn: emptyFunc
    },

    /**
     * Hostname verification
     *
     * @function
     * @public
     * @param {string} host - Hostname to verify
     * @returns {boolean} - true if valid, false if not
     */
    isHostnameValid: function (host) {
        return (typeof host === 'string' && host.length !== 0 && host.search(/^[\w\-]+(\.[\w\-]+)*$/) !== -1);
    },

    /**
     * Method verification
     *
     * @function
     * @public
     * @param {string} method - Method to verify
     * @returns {boolean} - true if valid, false if not
     */
    isMethodValid: function (method) {
        return (typeof method === 'string' && method.length !== 0 && methods.indexOf(method) !== -1);
    },

    /**
     * Write method check
     *
     * @function
     * @public
     * @param {string} method - Method to check
     * @returns {boolean} - true if "write" method, false if not
     */
    isWriteMethod: function (method) {
        return (typeof method === 'string' && method.length !== 0 && writeMethods.indexOf(method) !== -1);
    },

    /**
     * Get port value with suitable default from urlObject
     *
     * @function
     * @public
     * @param {object} url - The urlObject to pull port from
     * @returns {number} - The port number.  If not specified, returns default for proto (80 or 443).
     */
    portFromUrlObject: function (url) {
        return url.port ? url.port : (url.proto === 'https:' ? 443 : 80);
    },

    /**
     * Extract port from full hostname (thanks for making us have to do this ExpressJS)
     *
     * @function
     * @public
     * @param {string} host - The host string
     * @param {string} proto - The protocol string (http | https)
     * @returns {number} - The port number.  If not specified, returns default for proto (80 or 443).
     */
    extractPortFromHost: function (host, proto) {
        let port,
            ppos;

        if (host.charAt(0) === '[') {
            // IPv6 address
            ppos = host.indexOf(']') + 1;
            if (ppos === 0 || host.charAt(ppos) !== ':') {
                ppos = -1;
            }
        } else {
            ppos = host.indexOf(':');
        }
        if (ppos !== -1) {
            let pstring = host.substring(ppos);
            port = parseInt(pstring.substring(1), 10);
            if (port <= 0) {
                port = (proto === 'https') ? 443 : 80;
            }
        } else {
            port = (proto === 'https') ? 443 : 80;
        }
        return port;
    },

    /**
     * Check request hostname, port, protocol, and method against relevant route matching values, if set.
     *
     * @function
     * @public
     * @param {object} req - The request object
     * @param {object} r - The route object
     * @returns {boolean} - true if matching or unset, false if not a match
     */
    doRuntimeChecks: function (req, r) {
        return ((r.methodMatch.length !== 0 && r.methodMatch !== req.method) ||
            (r.allowWrite !== true && r.methodMatch.length === 0 && writeMethods.indexOf(req.method) !== -1) ||
            (r.portMatch !== 0 && r.portMatch !== req.port) ||
            (r.hostMatch.length !== 0 && r.hostMatch !== req.hostname) ||
            (r.protoMatch.length !== 0 && r.protoMatch !== req.protocol)) ? false : true;
    },

    /**
     * Substitution Parser
     *
     * @function
     * @public
     * @param {string} orig - Original string to parse
     * @param {object} subs - Substitution object
     * @returns {string} - String with substitutions made
     */
    substitute: function (orig, subs) {
        let ns = orig;

        if (typeof ns === 'string' && typeof subs === 'object' && subs !== null) {
            for (let se, ss = ns.indexOf('%'), sw; ss !== -1;) {
                if ((se = ns.indexOf('%', ss + 1)) === -1) {
                    break;
                }
                sw = ns.slice(ss + 1, se);
                if (sw.length !== 0 && typeof subs[sw] === 'string') {
                    if (++se >= ns.length) {
                        ns = (ss === 0 ? '' : ns.slice(0, ss)) + subs[sw];
                        break;
                    }
                    ns = (ss === 0 ? '' : ns.slice(0, ss)) + subs[sw] + ns.slice(se);
                    ss = ns.indexOf('%', ss + subs[sw].length);
                } else {
                    ss = se;
                }
            }
        }

        return ns;
    },

    /**
     * Shallow copy headers from one response object to another
     *
     * @function
     * @public
     * @param {object} copyTo - The response object to copy headers to
     * @param {object} copyFrom - The headers object to copy from
     */
    cloneResponseHeaders: function (copyTo, copyFrom) {
        for (let key in copyFrom) {
            if (copyFrom.hasOwnProperty(key)) {
                copyTo.setHeader(key, copyFrom[key]);
            }
        }
    },

    /**
     * Merge two header objects
     *
     * @function
     * @public
     * @param {object} base - Base header object
     * @param {object} extra - Added header object
     * @throws {error} - If header values are invalid
     * @returns {object} - Merged header object
     */
    mergeHeaders: function (base, extra) {
        let h,
            mh = {};

        if (typeof base === 'object' && base !== null) {
            for (h in base) {
                if (base.hasOwnProperty(h)) {
                    if (typeof base[h] !== 'string') {
                        throw new Error(`Invalid header "${h}" value!`);
                    }
                    mh[h.toLowerCase()] = base[h];
                }
            }
        }
        if (typeof extra === 'object' && extra !== null) {
            for (h in extra) {
                if (extra.hasOwnProperty(h)) {
                    if (typeof extra[h] !== 'string' && typeof extra[h] !== 'number') {
                        throw new Error(`Invalid header "${h}" value!`);
                    }
                    mh[h.toLowerCase()] = extra[h];
                }
            }
        }
        return mh;
    }
};


module.exports = utils;

