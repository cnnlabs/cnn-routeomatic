/**
 * Route-o-matic Request object type
 *
 * @module rom-request
 */

'use strict';

const
    ContentType = require('content-type'),
    getRawBody = require('raw-body'),
    Http = require('http'),
    Http2 = require('http2'),
    Https = require('https'),
    HttpError = require('./http-error'),
    Mime = require('mime'),
    QS = require('qs'),
    Query = require('querystring'),
    redirectCodes = [301, 302, 303, 307, 308],
    Url = require('url'),
    utils = require('./utils');


/**
 * RomRequest object constructor
 *
 * @constructor
 * @param {object} settings - RouteOMatic settings object
 */
function RomRequest(settings) {
    // Initialize this object
    this.body = null;
    this.dnsLookup = settings.dnsLookup;
    this.headers = null;
    this.hostConfig = null;
    this.hostTable = settings.hostTable;
    this.logger = settings.requestLogger;
    this.logPrefix = '';
    this.onSent = settings.onSent;
    this.routePass = 0;
    this.serverNext = null;
    this.serverResponse = null;
    this.serverRequest = null;
    this.settings = settings;
    this.timeout = settings.timeout;
    this.type = '';

    // Setup the request logger.
    this.log = {
        silly: (msg) => this.logger.silly(this.logPrefix + msg, this.logMeta),
        debug: (msg) => this.logger.debug(this.logPrefix + msg, this.logMeta),
        verbose: (msg) => this.logger.verbose(this.logPrefix + msg, this.logMeta),
        info: (msg) => this.logger.info(this.logPrefix + msg, this.logMeta),
        warn: (msg) => this.logger.warn(this.logPrefix + msg, this.logMeta),
        error: (msg) => this.logger.error(this.logPrefix + msg, this.logMeta),
        fatal: (msg) => this.logger.fatal(this.logPrefix + msg, this.logMeta),
        important: (msg) => this.logger.important(this.logPrefix + msg, this.logMeta)
    };
}


/**
 * Normalize and reduce the request URL, if necessary
 *
 * @memberof RomRequest
 * @private
 * @static
 * @param {string} url - Request URL
 * @returns {mixed} - Reduced URL string, null if bad URL
 */
RomRequest.normalizeAndReduce = function (url) {
    let nlFlag = false,
        ppos,
        qpos,
        newUrl = url.replace(/%[\dA-Fa-f]{2}/g, (mtch) => {
            let val = parseInt(mtch.slice(1), 16);
            if (val === 0x2D || val === 0x2E || val === 0x5F || val === 0x7E || (val >= 0x41 && val <= 0x5A) || (val >= 0x30 && val <= 0x39)) {
                return String.fromCharCode(val);
            }
            if (val === 0x0A || val === 0x0D) {
                nlFlag = true;
            }
            return mtch.toUpperCase();
        });

    // If the URL still contains percent characters, or if the URL and params contain linefeeds, return a null.
    if (nlFlag === true || ((ppos = newUrl.indexOf('%')) !== -1 && ((qpos = newUrl.indexOf('?')) === -1 || ppos < qpos))) {
        return null;
    }
    return newUrl;
};


/**
 * Tweak the headers
 *
 * @memberof RomRequest
 * @private
 * @returns {object} - merged headers
 */
RomRequest.prototype.responseHeaders = function () {
    let headers = null;

    if (this.hostConfig.headers !== null) {
        if (this.headers !== null) {
            headers = utils.mergeHeaders(this.hostConfig.headers, this.headers);
        } else {
            headers = this.hostConfig.headers;
        }
    } else if (this.headers !== null) {
        headers = this.headers;
    }
    return headers;
};


/**
 * Log whatever
 *
 * @memberof RomRequest
 * @public
 */


/**
 * End response and finish request
 *
 * @memberof RomRequest
 * @public
 * @param {number} code - Status code to send with, if any
 */
RomRequest.prototype.end = function (code) {
    if (code) {
        if (code > 309 && code < 600) {
            this.error(code);
        } else {
            this.serverResponse.status(code).end();
            this.log.debug(`Request ended (${code}).`);
        }
    } else {
        this.serverResponse.end();
        this.log.debug('Request ended.');
    }
    if (this.onSent !== null) {
        this.onSent(this.serverRequest, this.serverResponse);
    }
};


/**
 * Send an error
 *
 * @memberof RomRequest
 * @public
 * @param {number} [code] - Status code of error to send (default is 500)
 * @param {string} [message] - Optional message to attach to error
 */
RomRequest.prototype.error = function (code, message) {
    this.serverResponse.locals.isXhr = this.isXhr;
    this.serverNext(new HttpError(code || 500, message));
};


/**
 * Send normal content
 *
 * @memberof RomRequest
 * @private
 * @param {number} status - Status code to send with
 * @param {mixed} content - The string, buffer, or object to send.
 */
RomRequest.prototype.send = function (status, content) {
    let resp = this.serverResponse;

    try {
        let hdrs = this.responseHeaders();

        // Validate the status code
        if (typeof status !== 'number' || status < 100 || status > 599) {
            this.log.warn('Invalid status code passed to send function.  Using default code 200.');
            status = 200;
        }
        // Handle the headers
        if (hdrs !== null) {
            resp.set(hdrs);
        }
        if (this.type.length !== 0) {
            resp.type(this.type);
        } else {
            resp.type(Mime.getType(this.path) || 'text/html');
        }
        // Send the status code and the response content
        resp.status(status).send(content);
        if (this.onSent !== null) {
            this.onSent(this.serverRequest, resp);
        }
        this.log.debug(`Response sent (${status}).`);
    } catch (err) {
        this.log.error(`Error sending response: ${err.message}`);
        this.error(500);
    }
};


/**
 * Send json content
 *
 * @memberof RomRequest
 * @public
 * @param {number} status - Status code to send with
 * @param {object|array|string|boolean|number} content - Content to JSON encode and send
 */
RomRequest.prototype.json = function (status, content) {
    try {
        let data = JSON.stringify(content);
        this.type = 'json';
        this.send(status, data);
    } catch (err) {
        this.log.error(`Error sending JSON response: ${err.message}`);
        this.error(500);
    }
};


/**
 * Send jsonp content
 *
 * @memberof RomRequest
 * @public
 * @param {number} status - Status code to send with
 * @param {object|array|string|boolean|number} content - Content to JSON encode and send
 * @param {string} [callback] - Optional callback query param name (default is "callback")
 */
RomRequest.prototype.jsonp = function (status, content, callback) {
    callback = callback || 'callback';
    try {
        let data = JSON.stringify(content);
        this.type = 'json';
        if (typeof this.queryParams[callback] === 'string' && this.queryParams[callback].length !== 0) {
            this.headers = this.headers || {};
            this.headers['x-content-type-options'] = 'nosniff';
            data = this.queryParams[callback] + '(' + data + ')';
        }
        this.send(status, data);
    } catch (err) {
        this.log.error(`Error sending JSON response: ${err.message}`);
        this.error(500);
    }
};


/**
 * Send a file
 *
 * @memberof RomRequest
 * @private
 * @param {string} filepath - The full path of the file to send
 * @param {object} options - sendFile options
 */
RomRequest.prototype.sendFile = function (filepath, options) {
    try {
        let hdrs,
            resp = this.serverResponse;

        options = options || {};

        // Handle the headers
        hdrs = this.responseHeaders();
        if (hdrs !== null) {
            options.headers = options.headers ? utils.mergeHeaders(hdrs, options.headers) : hdrs;
        }
        if (this.type) {
            resp.type(this.type);  // This may or may not work here
        } // else handled by Express response sendFile

        // Send the file
        resp.sendFile(filepath, options, (err) => {
            if (err) {
                if (err.status === 404 || err.code === 'EISDIR') {
                    this.log.debug(`Unable to send file, not found: "${filepath}"`);
                } else {
                    this.log.error(`Error sending file "${filepath}": ${err.status} - ${err.message}`);
                }
                this.error(err.status || 500);
            } else {
                if (this.onSent !== null) {
                    this.onSent(this.serverRequest, resp);
                }
                this.log.debug(`Sent file "${filepath}"`);
            }
        });
    } catch (err) {
        this.log.error(`Error sending response: ${err.message}`);
        this.error(500);
    }
};


/**
 * Proxy the response through another server with Express
 *
 * @memberof RomRequest
 * @private
 * @param {object} options - Route options object
 */
RomRequest.prototype.proxy = function (options) {
    try {
        let handleProxyResponse,
            reqHeaders = {},
            newReq,
            proto,
            protoVer,
            proxy = (options && options.proxy) || null,
            pUrl,
            resp = this.serverResponse;

        // Handle bad proxy host
        if (proxy === null || typeof proxy !== 'object' || typeof proxy.hostname !== 'string' || proxy.hostname.length <= 0) {
            this.log.error('Proxy hostname not set');
            if (resp.headersSent !== true) {
                this.error(502, 'Proxy hostname not set');
                return;
            }
        }

        // Figure out the proto to use, if any
        protoVer = proxy.protoVer || this.protoVer || '1.1';
        proto = (proxy.proto || (protoVer === '2.0' && 'https') || this.proto) + ':';

        // Setup proxy destination
        options.fullUrl = {
            auth: proxy.auth || this.auth || null,
            hash: proxy.hash || this.hash || null,
            hostname: proxy.hostname,
            pathname: proxy.path || this.path,
            port: proxy.port || null,
            protocol: proto,
            search: proxy.query || null
        };

        // If we are doing path replacement, do it now...
        if (typeof proxy.pathReplace === 'string' && (typeof proxy.pathMatch === 'string' || proxy.pathMatch instanceof RegExp)) {
            options.fullUrl.pathname = options.fullUrl.pathname.replace(proxy.pathMatch, proxy.pathReplace);
        }

        pUrl = Url.format(options.fullUrl);
        options.fullUrl.href = pUrl;
        this.log.debug(`Proxying request to ${pUrl}`);

        // Shallow copy the request headers
        reqHeaders = utils.mergeHeaders({}, this.serverRequest.headers);
        if (typeof options.proxy.headers === 'object') {
            reqHeaders = utils.mergeHeaders(reqHeaders, options.proxy.headers);
        }
        // Tweak the X-Forwarded-For header
        if (typeof reqHeaders['x-forwarded-for'] === 'string' && reqHeaders['x-forwarded-for'].length !== 0) {
            reqHeaders['x-forwarded-for'] += ', ' + this.serverRequest.connection.localAddress;
        } else {
            reqHeaders['x-forwarded-for'] = this.serverRequest.ip;
        }
        if (proto !== this.proto && !reqHeaders['x-forwarded-proto']) {
            reqHeaders['x-forwarded-proto'] = this.proto;
        }
        if (!reqHeaders['x-forwarded-host']) {
            reqHeaders['x-forwarded-host'] = this.headerHost;
        }

        // Setup the proxy HTTP options
        options.httpOpts = {
            auth: options.fullUrl.auth,
            headers: reqHeaders,
            hostname: options.fullUrl.hostname,
            method: this.method || 'GET',
            path: options.fullUrl.pathname + (options.fullUrl.search ? (options.fullUrl.search.charAt(0) === '?' ? '' : '?') + options.fullUrl.search : ''),
            port: options.fullUrl.port,
            protocol: options.fullUrl.protocol
        };
        options.timeout = (typeof options.timeout === 'number') ? options.timeout : this.timeout;
        options._rom = this;

        // Handle the proxy headers
        if (this.hostConfig.proxyHeaders !== null) {
            if (this.headers !== null) {
                options.httpOpts.proxyHeaders = utils.mergeHeaders(this.hostConfig.proxyHeaders, this.headers);
            } else {
                options.httpOpts.proxyHeaders = this.hostConfig.proxyHeaders;
            }
        } else if (this.headers !== null) {
            options.httpOpts.proxyHeaders = this.headers;
        } else {
            options.httpOpts.proxyHeaders = null;
        }

        // Support alternate DNS lookup
        if (this.dnsLookup !== null) {
            options.httpOpts.lookup = this.dnsLookup;
        }

        // Function to handle the initial proxy response
        handleProxyResponse = function (opts, proxyResp) {
            let proxyRespCode = Number(proxyResp.statusCode),
                servResp = opts._rom.serverResponse;

            proxyResp.on('error', (error) => {
                opts._rom.log.error(`Proxy request response error (${opts.fullUrl.href}): ${error.message}\n${error.stack}`);
                proxyResp.resume();
                opts._rom.error(502);
            });

            if (opts._rom.onSent !== null) {
                proxyResp.on('end', () => {
                    opts._rom.onSent(opts._rom.serverRequest, servResp);
                });
            }

            // Clone response headers
            utils.cloneResponseHeaders(servResp, proxyResp.headers);

            servResp.statusCode = proxyRespCode;

            if (proxyRespCode < 200 || proxyRespCode >= 300) {
                // Explicit handling of redirects.  If the 'location' header
                // contains the proxy host, replace it with empty string to
                // get the the redirect to go to THIS server.
                if (redirectCodes.indexOf(proxyRespCode) !== -1) {
                    try {
                        let loc = servResp.getHeader('location');

                        if (typeof loc === 'string') {
                            let locUrl = Url.parse(loc);

                            if (locUrl.host === opts.fullUrl.host && locUrl.port === opts.fullUrl.port) {
                                servResp.setHeader('location', loc.replace(/^http(s)?:\/\/[\w\.\-]+(\:\d+)?/, ''));
                            }
                        }
                    } catch (e) {
                        opts._rom.log.error(`Error attempting to set 301/302 headers for proxied request: ${e.message}`);
                    }
                }
            } else {
                opts._rom.log.debug(`Proxy response status code ${proxyRespCode}`);
                servResp.statusCode = proxyRespCode;
                // Merge in the relevant proxy response headers, if any
                if (opts.httpOpts.proxyHeaders !== null) {
                    try {
                        utils.cloneResponseHeaders(servResp, opts.httpOpts.proxyHeaders);
                    } catch (e) {
                        opts._rom.log.error(`Error attempting to set headers for proxied request: ${e.message}`);
                    }
                }
            }

            // Pipe new connection to existing response
            proxyResp.pipe(servResp, {end: true});
            opts._rom.log.debug('Connection proxied to client.');
        }.bind(this, options);

        // Make the request to the back-end server
        if (options.fullUrl.protocol === 'https:') {
            if (protoVer.charAt(0) === '2') {
                newReq = Http2.request(options.httpOpts, handleProxyResponse);
            } else {
                newReq = Https.request(options.httpOpts, handleProxyResponse);
            }
        } else {
            newReq = Http.request(options.httpOpts, handleProxyResponse);
        }

        // Handle events on the new request
        newReq.on('socket', (socket) => {
            // Handle socket timeout, if set
            if (options.timeout > 0) {
                socket.on('timeout', () => {
                    this.log.debug(`Proxy request took over ${options.timeout}ms to return; request timed-out.`);
                    socket.destroy();
                });
                socket.setTimeout(options.timeout);
            }
            // Handle socket error
            socket.on('error', (error) => {
                this.log.error(`Proxy socket error handling request to ${options.fullUrl.href}: ${error.message}`);
                socket.destroy();
            });
        });
        newReq.on('error', (error) => {
            this.log.error(`Proxy error for request "${options.fullUrl.href}": ${error.message}`);
            this.error(500);
        });
        // POST not yet supported, but the newReq.write(postData) for that would be here.
        newReq.end();
    } catch (err) {
        this.log.error(`Error proxying request: ${err.message}`);
        this.error(500);
    }
};


/**
 * Do a redirect through Express
 *
 * @memberof RomRequest
 * @private
 * @param {number} code - Redirect code to use as status
 * @param {string} location - New location URL string to redirect to
 */
RomRequest.prototype.redirect = function (code, location) {
    try {
        let resp = this.serverResponse;

        // Validate the redirect code
        if (typeof code !== 'number' || code < 300 || code > 310) {
            this.log.warn(`Invalid status code passed to "redirect" function.  Using default redirect code ${this.settings.redirectCode}.`);
            code = this.settings.redirectCode;
        }
        // Handle the redirect headers
        if (this.hostConfig.redirectHeaders !== null) {
            if (this.headers !== null) {
                resp.set(utils.mergeHeaders(this.hostConfig.redirectHeaders, this.headers));
            } else {
                resp.set(this.hostConfig.redirectHeaders);
            }
        } else if (this.headers !== null) {
            resp.set(this.headers);
        }
        // Send the redirect
        resp.redirect(code, location);
        if (this.onSent !== null) {
            this.onSent(this.serverRequest, resp);
        }
        this.log.info(`Redirected request to ${location}`);
    } catch (err) {
        this.log.error(`Error sending redirect: ${err.message}`);
        this.error(500);
    }
};


/**
 * Do a rewrite
 *
 * @memberof RomRequest
 * @private
 * @param {string} newUrl - New URL to rewrite request to.
 */
RomRequest.prototype.rewrite = function (newUrl) {
    try {
        // Pull apart new URL, check for redirecting changes
        let url = Url.parse(newUrl);

        if (url.hostname !== null && ((url.hostname !== this.hostname) ||
            (url.protocol !== null && url.protocol !== (this.proto + ':')) ||
            (url.port !== null && parseInt(url.port, 10) !== this.port))) {

            // Change in host, protocol, or port, so requires redirecting
            this.redirect(this.settings.redirectCode, newUrl);
        } else {
            // Normalize and reduce, if necessary
            if (this.settings.normalizeUrls === true) {
                let normed = RomRequest.normalizeAndReduce(newUrl);

                if (normed === null) {
                    // If the URL still contains percent characters, or if the URL and params contain linefeeds, throw an error
                    throw new Error(`Rewritten request "${newUrl}" now contains invalid characters`);
                }
                if (normed.length < this.url.length) {
                    // Modified, so deal with the path and update the request values
                    url = Url.parse(normed);
                }
            }
            if (this.settings.removeDoubleSlashes === true && url.pathname.indexOf('//') !== -1) {
                let newPath = url.pathname.replace(/\/\/+/g, '/');

                this.log.debug(`Reduced the rewritten request path "{$url.pathname}" to "${newPath}"`);
                url.pathname = newPath;
                url.path = newPath + (typeof url.search === 'string' ? url.search : '');
            }

            // Update the request object
            this.path = (typeof url.pathname === 'string' && url.pathname.length !== 0) ? url.pathname : '/';
            this.normalizedPath = this.path.toLowerCase();
            this.url = (typeof url.path === 'string' && url.path.length !== 0) ? url.path : '/';
            if ((this.port === 80 && this.proto === 'http') || (this.port === 443 && this.proto === 'https')) {
                this.href = this.proto + '://' + this.hostname + url.path;
            } else {
                this.href = this.proto + '://' + this.hostname + ':' + this.port.toString(10) + this.url;
            }

            // Continue route processing
            this.log.info(`Rewrote request to ${newUrl}`);
            this.doRoute();
        }
    } catch (err) {
        this.log.error(`Error handling rewrite of request to "${newUrl}": ${err.message}`);
        this.error(500);
    }
};


/**
 * Route or re-route a request
 *
 * @memberof RomRequest
 * @private
 */
RomRequest.prototype.doRoute = function () {
    try {
        let host,
            result,
            routes;

        if (this.routePass++ > this.settings.retryLimit) {
            throw new Error(`Exceeded routing retry limit (${this.settings.retryLimit}) with original URL "${this.serverRequest.originalUrl}"`);
        }

        // Get the host details
        host = this.hostTable.getHost(this.hostname);
        if (host === null) {
            // Host not found, return error
            this.log.info(`Invalid hostname "${this.host}", sending error 503.`);
            this.error(503, `Invalid server hostname "${this.host}".`);
            return;
        }

        // Set request settings from host config
        this.hostConfig = host.config;
        this.timeout = host.config.timeout;

        // Get routes
        routes = host.routeResolvers;

        // Check each route resolver
        result = false;
        for (let i = 0, rl = routes.length; result === false && i < rl; i++) {
            result = routes[i](this);
        }
        // Handle 404 if no route found
        if (result === false) {
            this.log.debug('No route found for request');
            this.error(404);
        }
    } catch (err) {
        this.log.error(`Critical error in routing request: ${err.message}`, err);
        this.error(500);
    }
};


/**
 * Process RomRequest request
 *
 * @memberof RomRequest
 * @param {object} req - Request object (Express)
 * @param {object} res - Response object (HTTP/HTTPS/HTTP2)
 * @param {function} next - Continuation function (Express)
 */
RomRequest.prototype.process = function (req, res, next) {
    this.logPrefix = res.locals.logPrefix || '';
    if (typeof res.locals.logMeta === 'object' && res.locals.logMeta !== null) {
        this.logMeta = res.locals.logMeta;
    }
    this.log.debug(`Initializing ROM Request for ${req.path}`);

    try {
        let curAddr = req.socket.address(),
            curPort = this.settings.ports[curAddr.port] || null,
            hname = req.hostname.toLowerCase().replace(/[\s,]+.*$/, ''),
            hh = (req.headers && req.headers.host) || hname,
            prot = (curPort && curPort.origProto) || req.protocol,
            pstring = '',
            url = Url.parse(prot + '://' + hh + req.url, false, false);

        // Initialize this request
        this.auth = url.auth;
        this.hash = url.hash;
        this.headerHost = hh;
        this.hostname = hname;
        this.href = url.href;
        this.isXhr = req.xhr;
        this.method = req.method;
        this.normalizedPath = url.pathname.toLowerCase();
        this.path = url.pathname;
        this.port = utils.portFromUrlObject(url);
        this.proto = prot;  // Hopefully, original request protocol
        this.protoVer = (curPort && curPort.origProtoVer) || (prot === 'https' && this.serverRequest.httpVersion.charAt(0) === '2' ? '2.0' : '1.1');
        this.query = url.query;
        this.serverNext = next;
        this.serverResponse = res;
        this.serverRequest = req;
        this.serverPort = curAddr.port;
        this.serverProto = req.protocol;
        this.url = req.url;

        if (typeof req.headers.host !== 'string') {
            this.log.error('No host header in request!');
            next(new HttpError('No host header in request!', 400));
            return;
        }
        if ((this.proto === 'http' && this.port !== 80) || (this.proto === 'https' && this.port !== 443)) {
            pstring = ':' + this.port.toString(10);
        }

        // Remove double slashes and redirect, if we should
        if (this.settings.removeDoubleSlashes === true && req.path.indexOf('//') !== -1) {
            let qp = req.url.indexOf('?'),
                newUrl = req.path.replace(/\/\/+/g, '/') + (qp === -1 ? '' : req.url.substr(qp));

            this.log.debug('Reduced the request path and redirecting.');
            res.redirect(this.settings.reduceRedirectCode, newUrl);
            if (this.onSent !== null) {
                this.onSent(req, res);
            }
            return;
        }

        // Normalize and reduce, if necessary
        if (this.settings.normalizeUrls === true) {
            let normed = RomRequest.normalizeAndReduce(req.url);

            if (normed === null) {
                // If the URL still contains percent characters, or if the URL and params contain linefeeds, return a 404.
                this.log.debug('URL contains invalid characters, sending 404.');
                next(new HttpError(404));
                return;
            }
            // Modified, so deal with the path and update the request values
            if (normed.length !== req.url.length) {
                req.url = normed;
                // No setter for req.path, but the getter extracts it from the url pathname
                // req.path = RomRequest.normalizeAndReduce(req.path);
                url = Url.parse(prot + '://' + hh + pstring + req.url, false, false);
                this.auth = url.auth;
                this.hash = url.hash;
                this.href = url.href;
                this.normalizedPath = url.pathname.toLowerCase();
                this.path = url.pathname;
                this.query = url.query;
                this.url = req.url;
            }
        }

        // Parse query parameters
        this.queryParams = Query.parse(url.query) || {};

        // If "write" request, check for a body
        if (utils.isWriteMethod(req.method)) {
            let clh = req.get('content-length'),
                cth = req.get('content-type');

            if (typeof cth === 'string' && cth.length !== 0 && typeof clh === 'string') {
                let cl = parseInt(clh, 10),
                    ct = ContentType.parse(cth),
                    en = (ct.parameters && ct.parameters.charset) || 'utf8';

                switch (ct.type) {
                case 'application/json':
                    getRawBody(req, {
                        encoding: en,
                        length: cl,
                        limit: '200kb'
                    }, (err, body) => {
                        if (err) {
                            this.log.debug(`Failed to process request body: ${err}`);
                            next(new HttpError(err.statusCode));
                        } else {
                            try {
                                this.body = JSON.parse(body);
                            } catch (e) {
                                next(new HttpError(400));
                                return;
                            }
                            this.doRoute();
                        }
                    });
                    break;
                case 'application/x-www-form-urlencoded':
                    getRawBody(req, {
                        encoding: en,
                        length: cl,
                        limit: '200kb'
                    }, (err, body) => {
                        if (err) {
                            this.log.debug(`Failed to process request body: ${err}`);
                            next(new HttpError(err.statusCode));
                        } else {
                            try {
                                this.body = QS.parse(body);
                            } catch (e) {
                                next(new HttpError(400));
                                return;
                            }
                            this.doRoute();
                        }
                    });
                    break;
                default:
                    getRawBody(req, {
                        encoding: en,
                        length: cl,
                        limit: '200kb'
                    }, (err, body) => {
                        if (err) {
                            this.log.debug(`Failed to process request body: ${err}`);
                            next(new HttpError(err.statusCode));
                        } else {
                            this.body = body;
                            this.doRoute();
                        }
                    });
                }
            } else {
                this.body = null;
                this.doRoute();
            }
        } else {
            // Done processing the request and creating the new request object, now route the thing
            this.doRoute();
        }
    } catch (err) {
        this.log.error(`Error processing request: ${err.message}`);
        next(new HttpError(500));
    }
};


module.exports = RomRequest;

