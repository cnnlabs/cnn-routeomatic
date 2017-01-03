/**
 * Route-o-matic Request object type
 *
 * @module rom-request
 */

'use strict';

const
    Http = require('http'),
    Http2 = require('http2'),
    Https = require('https'),
    HttpError = require('./http-error'),
    Mime = require('mime'),
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
    this.headers = null;
    this.hostConfig = null;
    this.hostTable = settings.hostTable;
    this.log = settings.requestLogger;
    this.routePass = 0;
    this.serverNext = null;
    this.serverResponse = null;
    this.serverRequest = null;
    this.settings = settings;
    this.timeout = settings.timeout;
    this.type = '';
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
        newUrl = url.replace(/%[0-9A-Fa-f]{2}/, (mtch) => {
            let val = parseInt(mtch.substr(1), 16);
            if (val === 0x2D || val === 0x2E || val === 0x5F || val === 0x7E || (val >= 0x41 && val <= 0x5A) || (val >= 0x30 && val <= 0x39)) {
                return String.fromCharCode(val);
            }
            if (val === 0x0A || val === 0x0D) {
                nlFlag = true;
            }
            return mtch.toUpperCase();
        });

    // If the URL still contains percent characters, or if the URL and params contain linefeeds, return a null.
    if (nlFlag === true || url.indexOf('%') !== -1) {
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
    let headers = null,
        self = this;

    if (self.hostConfig.headers !== null) {
        if (self.headers !== null) {
            headers = utils.mergeHeaders(self.hostConfig.headers, self.headers);
        } else {
            headers = self.hostConfig.headers;
        }
    } else if (self.headers !== null) {
        headers = self.headers;
    }
    return headers;
};


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
    let self = this,
        resp = self.serverResponse;

    try {
        let hdrs;

        // Validate the status code
        if (typeof status !== 'number' || status < 100 || status > 599) {
            self.log.warn('Invalid status code passed to send function.  Using default code 200.');
            status = 200;
        }
        // Handle the headers
        hdrs = self.responseHeaders();
        if (hdrs !== null) {
            resp.set(hdrs);
        }
        if (self.type.length !== 0) {
            resp.type(self.type);
        } else {
            resp.type(Mime.lookup(self.path));
        }
        // Send the status code and the response content
        resp.status(status).send(content);
        self.log.debug(`Response sent (${status}).`);
    } catch (err) {
        self.log.error(`Error sending response: ${err.message}`);
        self.error(500);
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
    let self = this;

    try {
        let hdrs,
            resp = self.serverResponse;

        options = options || {};

        // Handle the headers
        hdrs = self.responseHeaders();
        if (hdrs !== null) {
            options.headers = options.headers ? utils.mergeHeaders(hdrs, options.headers) : hdrs;
        }
        if (self.type) {
            resp.type(self.type);  // This may or may not work here
        } // else handled by Express response sendFile

        // Send the file
        resp.sendFile(filepath, options, (err) => {
            if (err) {
                if (err.status === 404) {
                    self.log.debug(`Unable to send file, not found: "${filepath}"`);
                } else {
                    self.log.error(`Error sending file "${filepath}": ${err.status} - ${err.message}`);
                }
                self.error(err.status || 500);
            } else {
                self.log.debug(`Sent file "${filepath}"`);
            }
        });
    } catch (err) {
        self.log.error(`Error sending response: ${err.message}`);
        self.error(500);
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
    let self = this;

    try {
        let handleProxyResponse,
            reqHeaders = {},
            isHttp2 = false,
            newReq,
            proto,
            proxy = (options && options.proxy) || null,
            pUrl,
            resp = self.serverResponse;

        // Handle bad proxy host
        if (proxy === null || typeof proxy !== 'object' || typeof proxy.hostname !== 'string' || proxy.hostname.length <= 0) {
            self.log.error('Proxy hostname not set');
            if (resp.headersSent !== true) {
                self.error(502, 'Proxy hostname not set');
                return;
            }
        }

        // Figure out the proto to use, if any
        if (proxy.proto) {
            isHttp2 = proxy.proto === 'http2';
            proto = (isHttp2 === true ? 'https' : proxy.proto) + ':';
        } else if (self.protocol) {
            isHttp2 = (self.proto === 'https' && self.serverRequest.httpVersion.charAt(0) === '2');
            proto = self.proto + ':';
        }

        // Setup proxy destination
        options.fullUrl = {
            auth: proxy.auth || self.auth || null,
            hash: proxy.hash || self.hash || null,
            hostname: proxy.hostname,
            path: proxy.path || self.path,
            port: proxy.port || null,
            protocol: proto,
            query: proxy.query || null
        };

        // If we are doing path replacement, do it now...
        if (typeof proxy.pathReplace === 'string' && (typeof proxy.pathMatch === 'string' || proxy.pathMatch instanceof RegExp)) {
            options.fullUrl.path = self.path.replace(proxy.pathMatch, proxy.pathReplace);
        }

        pUrl = Url.format(options.fullUrl);
        options.fullUrl.href = pUrl;
        self.log.debug(`Proxying request to ${pUrl}`);

        // Shallow copy the request headers
        reqHeaders = utils.mergeHeaders({}, self.serverRequest.headers);
        if (typeof options.proxy.headers === 'object') {
            reqHeaders = utils.mergeHeaders(reqHeaders, options.proxy.headers);
        }
        // Tweak the X-Forwarded-For header
        if (typeof reqHeaders['x-forwarded-for'] === 'string' && reqHeaders['x-forwarded-for'].length !== 0) {
            reqHeaders['x-forwarded-for'] += ', ' + self.serverRequest.connection.localAddress;
        } else {
            reqHeaders['x-forwarded-for'] = self.serverRequest.ip;
        }

        // Setup the proxy HTTP options
        options.httpOpts = {
            auth: options.fullUrl.auth,
            headers: reqHeaders,
            hostname: options.fullUrl.hostname,
            method: self.serverRequest.method,
            path: options.fullUrl.path + (options.fullUrl.query ? '?' + options.fullUrl.query : ''),
            port: options.fullUrl.port,
            protocol: options.fullUrl.protocol
        };
        options.timeout = (typeof options.timeout === 'number') ? options.timeout : self.timeout;

        // Handle the proxy headers
        if (self.hostConfig.proxyHeaders !== null) {
            if (self.headers !== null) {
                options.httpOpts.proxyHeaders = utils.mergeHeaders(self.hostConfig.proxyHeaders, self.headers);
            } else {
                options.httpOpts.proxyHeaders = self.hostConfig.proxyHeaders;
            }
        } else if (self.headers !== null) {
            options.httpOpts.proxyHeaders = self.headers;
        }

        // Function to handle the initial proxy response
        handleProxyResponse = function (opts, proxyResp) {
            let proxyRespCode = Number(proxyResp.statusCode),
                servResp = this.serverResponse;

            proxyResp.on('error', (error) => {
                this.log.error(`Proxy request response error (${opts.fullUrl.href}): ${error.message}\n${error.stack}`);
                proxyResp.resume();
                this.error(502);
            });

            servResp.statusCode = proxyRespCode;
            if (proxyRespCode < 200 || proxyRespCode >= 300) {
                // Explicit handling of redirects.  If the 'location' header
                // contains the proxy host, replace it with empty string to
                // get the the redirect to go to THIS server.
                if (redirectCodes.indexOf(proxyRespCode) !== -1) {
                    try {
                        servResp.setHeader('location', proxyResp.headers.location.replace(opts.proxyHost, '').replace(/^http(s)?:\/\/(\:\d+)?/, ''));
                    } catch (e) {
                        this.log.error(`Error attempting to set 301/302 headers for proxied request: ${e.message}`);
                    }
                }
            } else {
                this.log.debug(`Proxy response status code ${proxyRespCode}`);
                servResp.statusCode = proxyRespCode;
            }

            // Clone response headers
            utils.cloneResponseHeaders(servResp, proxyResp);

            // Pipe new connection to existing response
            proxyResp.pipe(servResp, {end: true});
            this.log.debug('Connection proxied to client.');
        };

        // Make the request to the back-end server
        if (options.fullUrl.protocol === 'https:') {
            if (isHttp2 === true) {
                newReq = Http2.get(options.httpOpts, handleProxyResponse.bind(self, options));
            } else {
                newReq = Https.get(options.httpOpts, handleProxyResponse.bind(self, options));
            }
        } else {
            newReq = Http.get(options.httpOpts, handleProxyResponse.bind(self, options));
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
            self.log.error(`Proxy error for request "${options.fullUrl.href}": ${error.message}`);
        });
    } catch (err) {
        self.log.error(`Error proxying request: ${err.message}`);
        self.error(500);
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
    let self = this;

    try {
        let resp = self.serverResponse;

        // Validate the redirect code
        if (typeof code !== 'number' || code < 300 || code > 310) {
            self.log.warn(`Invalid status code passed to "redirect" function.  Using default redirect code ${self.settings.redirectCode}.`);
            code = self.settings.redirectCode;
        }
        // Handle the redirect headers
        if (self.hostConfig.redirectHeaders !== null) {
            if (self.headers !== null) {
                resp.set(utils.mergeHeaders(self.hostConfig.redirectHeaders, self.headers));
            } else {
                resp.set(self.hostConfig.redirectHeaders);
            }
        } else if (self.headers !== null) {
            resp.set(self.headers);
        }
        // Send the redirect
        resp.redirect(code, location);
        self.log.info(`Redirected request to ${location}`);
    } catch (err) {
        self.log.error(`Error sending redirect: ${err.message}`);
        self.error(500);
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
    let self = this;

    try {
        // Pull apart new URL, check for redirecting changes
        let url = Url.parse(newUrl);

        if (url.hostname !== null && ((url.hostname !== self.hostname) ||
            (url.protocol !== null && url.protocol !== (self.proto + ':')) ||
            (url.port !== null && parseInt(url.port, 10) !== self.port))) {

            // Change in host, protocol, or port, so requires redirecting
            self.redirect(self.settings.redirectCode, newUrl);
        } else {
            // Normalize and reduce, if necessary
            if (self.settings.normalizeUrls === true) {
                let normed = RomRequest.normalizeAndReduce(newUrl);

                if (normed === null) {
                    // If the URL still contains percent characters, or if the URL and params contain linefeeds, throw an error
                    throw new Error(`Rewritten request "${newUrl}" now contains invalid characters`);
                }
                if (normed.length < self.url.length) {
                    // Modified, so deal with the path and update the request values
                    url = Url.parse(normed);
                }
            }
            if (self.settings.removeDoubleSlashes === true && url.pathname.indexOf('//') >= 0) {
                let newPath = url.pathname.replace(/\/\/+/g, '/');

                self.log.debug(`Reduced the rewritten request path "{$url.pathname}" to "${newPath}"`);
                url.pathname = newPath;
                url.path = newPath + (typeof url.search === 'string' ? url.search : '');
            }

            // Update the request object
            self.path = (typeof url.pathname === 'string' && url.pathname.length > 0) ? url.pathname : '/';
            self.normalizedPath = self.path.toLowerCase();
            self.url = (typeof url.path === 'string' && url.path.length > 0) ? url.path : '/';
            if ((self.port === 80 && self.proto === 'http') || (self.port === 443 && self.proto === 'https')) {
                self.href = self.proto + '://' + self.hostname + url.path;
            } else {
                self.href = self.proto + '://' + self.hostname + ':' + self.port.toString(10) + self.url;
            }

            // Continue route processing
            self.log.info(`Rewrote request to ${newUrl}`);
            self.doRoute();
        }
    } catch (err) {
        self.log.error(`Error handling rewrite of request to "${newUrl}": ${err.message}`);
        self.error(500);
    }
};


/**
 * Route or re-route a request
 *
 * @memberof RomRequest
 * @private
 */
RomRequest.prototype.doRoute = function () {
    let self = this;

    try {
        let host,
            result,
            routes;

        if (self.routePass++ > self.settings.retryLimit) {
            throw new Error(`Exceeded routing retry limit (${self.settings.retryLimit}) with original URL "${self.serverRequest.originalUrl}"`);
        }

        // Get the host details
        host = self.hostTable.getHost(self.host);
        if (host === null) {
            // Host not found, return error
            self.log.info(`Invalid hostname "${self.host}", sending error 503.`);
            self.error(503, `Invalid server hostname "${self.host}".`);
            return;
        }

        // Set request settings from host config
        self.hostConfig = host.config;
        self.timeout = host.config.timeout;

        // Get routes
        routes = host.routeResolvers;

        // Check each route resolver
        result = false;
        for (let i = 0, rl = routes.length; result === false && i < rl; i++) {
            result = routes[i](self);
        }
        // Handle 404 if no route found
        if (result === false) {
            self.log.debug('No route found for request');
            self.error(404);
        }
    } catch (err) {
        self.log.error(`Critical error in routing request: ${err.message}`, err);
        self.error(500);
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
    let self = this;

    self.log.debug(`Initializing ROM Request for ${req.path}`);

    try {
        let
            hname = req.hostname.toLowerCase(),
            hh = (req.headers && req.headers.host) || hname,
            pstring = '',
            url = Url.parse(req.protocol + '://' + hh + req.url, false, false);

        // Initialize this request
        self.auth = url.auth;
        self.hash = url.hash;
        self.hostname = hname;
        self.href = url.href;
        self.isXhr = req.xhr;
        self.normalizedPath = url.pathname.toLowerCase();
        self.path = url.pathname;
        self.port = utils.portFromUrlObject(url);
        self.proto = req.protocol;
        self.query = url.query;
        self.serverNext = next;
        self.serverResponse = res;
        self.serverRequest = req;
        self.serverPort = req.app.settings.port;
        self.url = req.url;

        if (typeof req.headers.host !== 'string') {
            self.log.error('No host header in request!');
            next(new HttpError('No host header in request!', 400));
            return;
        }
        if ((req.protocol === 'http' && self.port !== 80) || (req.protocol === 'https' && self.port !== 443)) {
            pstring = ':' + self.port.toString(10);
        }

        // Remove double slashes and redirect, if we should
        if (self.settings.removeDoubleSlashes === true && req.path.indexOf('//') >= 0) {
            let qp = req.url.indexOf('?'),
                newUrl = req.path.replace(/\/\/+/g, '/') + (qp < 0 ? '' : req.url.substr(qp));

            self.log.debug('Reduced the request path and redirecting.');
            res.redirect(self.settings.reduceRedirectCode, newUrl);
            return;
        }

        // Normalize and reduce, if necessary
        if (self.settings.normalizeUrls === true) {
            let normed = RomRequest.normalizeAndReduce(req.url);

            if (normed === null) {
                // If the URL still contains percent characters, or if the URL and params contain linefeeds, return a 404.
                next(new HttpError(404));
                return;
            }
            // Modified, so deal with the path and update the request values
            if (normed.length !== req.url.length) {
                req.url = normed;
                req.path = RomRequest.normalizeAndReduce(req.path);
                url = Url.parse(req.protocol + '://' + hh + pstring + req.url, false, false);
                self.href = url.href;
                self.normalizedPath = url.pathname.toLowerString();
                self.path = url.pathname;
                self.query = url.query;
                self.url = req.url;
            }
        }

        // Parse query parameters
        self.queryParams = Query.parse(url.query) || {};

        // Done processing the request and creating the new request object, now route the thing
        self.doRoute();
    } catch (err) {
        self.log.error(`Error processing request: ${err.message}`);
        next(new HttpError(500));
    }
};


module.exports = RomRequest;

