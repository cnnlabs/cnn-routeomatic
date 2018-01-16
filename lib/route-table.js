'use strict';

const
    continents = require('../data/continents.json'),
    formatUrl = require('url').format,
    parseUrl = require('url').parse,
    regions = require('../data/regions.json'),
    TrieRoute = require('./trie-route'),
    utils = require('./utils');


/**
 * RouteTable Object constructor
 *
 * @constructor
 * @memberof RouteTable
 * @param {object} src - Source data for routes.
 * @param {object} config - Config object.
 * @param {object} [config.defaults] - Defaults object, optional
 * @param {number} [config.defaults.redirectCode] - Default redirect code to use, uses 302 if not set.
 * @param {object} [config.env] - Environment object
 * @param {object} [config.env.conds] - Environment object containing route conditionals
 * @param {object} [config.env.subs] - Environment object containing substitutions
 * @param {object} [config.log] - Shared logger, if used.
 * @param {object} config.routeHandlers - Route handler functions namespace object
 */
function RouteTable(src, config) {
    let cnt = 0,
        conds = null,
        defHandler = null,
        doSubs = false,
        routeHandlers,
        subs = null;

    // Initialize values
    this.count = 0;
    this.desc = '';
    this.forcePort = 0;
    this.forceProto = '';
    this.isCaseSpecific = true;
    this.isRegexMatch = false;
    this.isTrieMatch = false;
    this.matchType = 'trie';
    this.matchUsingQueryParams = false;
    this.resolver = null;
    this.routes = [];
    this.trie = null;

    // Validate route table source object
    if (typeof src !== 'object' || src === null ||
        typeof src.id !== 'string' || src.id.length === 0 ||
        !Array.isArray(src.routes) || src.routes.length === 0) {

        throw new Error('Invalid route configuration or route table source data!');
    }
    this.id = src.id;

    // Validate config object
    if (typeof config !== 'object' || config === null ||
        typeof config.routeHandlers !== 'object' || config.routeHandlers === null) {

        throw new Error('Invalid or empty route table config!');
    }

    // Use the shared log, if set
    this.log = config.log || utils.baseLogger;

    // Figure out the route handlers namespace
    if (typeof src.routeNamespace === 'string' && src.routeNamespace.length !== 0) {
        if (typeof config.routeHandlers[src.routeNamespace] !== 'object' || config.routeHandlers[src.routeNamespace] === null) {
            throw new Error(`Invalid route namespace "${src.routeNamespace}"!`);
        }
        routeHandlers = config.routeHandlers[src.routeNamespace];
    } else {
        routeHandlers = config.routeHandlers;
    }

    this.defaultRedirectCode = src.defaultRedirectCode || config.defaults.redirectCode || 302;
    if (typeof config.env === 'object' && config.env !== null) {
        conds = config.env.conds || null;
        subs = config.env.subs || null,
        doSubs = (subs !== null) ? true : false;
    }

    // Validate the match type (regex or trie) and set the resolver
    if (typeof src.matchType === 'string') {
        this.matchType = src.matchType.toLowerCase();
        if (this.matchType === 'regex') {
            this.resolver = this.checkRegexRoutes.bind(this);
            this.isRegexMatch = true;
        } else if (this.matchType === 'trie' || this.matchType === 'simple') {
            this.resolver = this.checkTrieRoutes.bind(this);
            this.isTrieMatch = true;
            this.trie = new TrieRoute();
        } else {
            throw new Error(`Invalid match type (${src.matchType}) for route table.`);
        }
    } else {
        throw new Error('Missing match type (regex, trie) for route table.');
    }

    // Set the description
    if (typeof src.desc === 'string') {
        this.desc = src.desc;
    }

    // Set the case-specific options
    if (typeof src.isCaseSpecific === 'boolean') {
        this.isCaseSpecific = src.isCaseSpecific;
    }

    // Set the matching using query params flag
    if (typeof src.matchUsingQueryParams === 'boolean') {
        this.matchUsingQueryParams = src.matchUsingQueryParams;
    }

    // Are we forcing use of HTTP or HTTPS?
    if (typeof src.forceProto === 'string' && src.forceProto.length !== 0) {
        this.forceProto = src.forceProto.toLowerCase();
        if (this.forceProto !== 'https' && this.forceProto !== 'http') {
            throw new Error(`Bad default forced protocol (${src.forceProto}) in route table.`);
        }
    }
    if (typeof src.forcePort === 'number' && src.forcePort >= 0) {
        this.forcePort = src.forcePort;
    }

    // Set the default handler, if any.  If not set, check for "routeHandlers.default" and use that.
    if (typeof src.defaultHandler === 'string' && src.defaultHandler.length !== 0) {
        if (typeof routeHandlers[src.defaultHandler] === 'function') {
            defHandler = routeHandlers[src.defaultHandler];
        } else {
            throw new Error(`Bad default handler "${src.defaultHandler}" specified for route table.`);
        }
    } else if (typeof routeHandlers.default === 'function') {
        defHandler = routeHandlers.default;
    }

    // Process the routes
    routeLoop: for (let r, i = 0; i < src.routes.length; i++) {
        r = src.routes[i];

        // Check conditionals, if conds configured
        if (typeof r.conds === 'object' && r.conds !== null) {
            if (conds === null) {
                continue routeLoop;  // Condition not set
            }
            for (let c in r.conds) {
                if (r.conds.hasOwnProperty(c)) {
                    if (!conds.hasOwnProperty(c)) {
                        continue routeLoop;  // Matching condition not set
                    }
                    if (typeof r.conds[c] === 'string' && doSubs === true) {
                        r.conds[c] = utils.substitute(r.conds[c], subs);
                    }
                    if (r.conds[c] !== conds[c]) {
                        continue routeLoop;  // Conditions do not match
                    }
                }
            }
        }

        // Do substitutions, if subs configured
        if (doSubs === true) {
            r.on = utils.substitute(r.on, subs);
        }

        // Verify we have a route
        if (typeof r.on !== 'string' || r.on.length === 0) {
            throw new Error('Invalid or empty route match.');
        }

        // If method match set, verify it
        if (typeof r.methodMatch === 'string' && r.methodMatch.length !== 0) {
            if (!utils.isValidMethod(r.methodMatch)) {
                throw new Error(`Invalid protocol (${r.methodMatch}) specified for route runtime method match.`);
            }
        } else {
            r.methodMatch = '';
        }

        // If hostname match and subs set, do substitutions
        if (typeof r.hostMatch === 'string') {
            if (doSubs === true) {
                r.hostMatch = utils.substitute(r.hostMatch, subs);
            }
            if (r.hostMatch.length !== 0 && !utils.isHostnameValid(r.hostMatch)) {
                throw new Error(`Invalid hostname (${r.hostMatch}) specified for route runtime hostname match.`);
            }
            r.hostMatch = r.hostMatch.toLowerCase();
        } else {
            r.hostMatch = '';
        }

        // If protocol match set, verify it
        if (typeof r.protoMatch === 'string' && r.protoMatch.length !== 0) {
            if (r.protoMatch.search(/^(http|https)$/) === -1) {
                throw new Error(`Invalid protocol (${r.protoMatch}) specified for route runtime protocol match.`);
            }
        } else {
            r.protoMatch = '';
        }

        // If port match set, verify it
        if (typeof r.portMatch === 'number') {
            if (r.portMatch < 0 || r.portMatch > 65535) {
                throw new Error(`Invalid port (${r.portMatch}) specified for route runtime port match.`);
            }
        } else {
            r.portMatch = 0;
        }

        // Force proto, if requested...
        if (typeof r.forceProto === 'string' && r.forceProto.length !== 0) {
            r.forceProto = r.forceProto.toLowerCase();
            r.forcePort = this.forcePort;
            if (r.forceProto !== 'https' && r.forceProto !== 'http') {
                throw new Error(`Bad forced protocol (${r.forceProto}) specified for route.`);
            }
        } else {
            r.forceProto = this.forceProto;
            if (r.forceProto.length !== 0) {
                r.forcePort = this.forcePort;
            }
        }

        // Setup handlers and prep routes based on route type
        if (typeof r.rewrite === 'string') {
            // This is a rewrite
            if (doSubs === true) {
                r.rewrite = utils.substitute(r.rewrite, subs);
                if (typeof r.replace === 'string') {
                    r.replace = utils.substitute(r.replace, subs);
                }
            }
            this.prepRewriteRoute(r);
            r.action = this.handleMatchedRewrite;
        } else if (typeof r.redirect === 'string') {
            // This is a redirect
            if (doSubs === true) {
                r.redirect = utils.substitute(r.redirect, subs);
            }
            this.prepRedirectRoute(r, (doSubs === true ? subs : null));
            r.action = this.handleMatchedRedirect;
        } else {
            if (typeof r.do === 'string') {
                // This is a handled route
                if (doSubs === true) {
                    r.do = utils.substitute(r.do, subs);
                }
                if (r.do.length !== 0 && typeof routeHandlers[r.do] === 'function') {
                    r.action = routeHandlers[r.do];
                } else {
                    throw new Error(`Invalid handler "${r.do}" for route #${i}: ${r.on}`);
                }
            } else if (defHandler !== null) {
                // This is a handled route using the default handler
                r.action = defHandler;
            } else {
                throw new Error(`Missing handler for route #${i}: ${r.on}`);
            }
            // Handle substitutions on known options
            if (doSubs === true && typeof r.options === 'object' && r.options !== null) {
                if (typeof r.options.proxy === 'object' && r.options.proxy !== null) {
                    if (typeof r.options.proxy.hostname === 'string') {
                        r.options.proxy.hostname = utils.substitute(r.options.proxy.hostname, subs);
                    }
                    if (typeof r.options.proxy.path === 'string') {
                        r.options.proxy.path = utils.substitute(r.options.proxy.path, subs);
                    }
                    if (typeof r.options.proxy.pathMatch === 'string') {
                        r.options.proxy.pathMatch = utils.substitute(r.options.proxy.pathMatch, subs);
                        if (r.options.proxy.pathMatch.search(/[\.\^\?\*\+\(\)\[\]\$\|\\]+/) !== -1) {
                            // Probably a RegExp, so try treating it as one...
                            try {
                                let re = new RegExp(r.options.proxy.pathMatch);
                                // Yep, let's use that
                                r.options.proxy.pathMatch = re;
                            } catch (rerr) {
                                // Apparently not, leave it as a string
                            }
                        }
                    }
                    if (typeof r.options.proxy.pathReplace === 'string') {
                        r.options.proxy.pathReplace = utils.substitute(r.options.proxy.pathReplace, subs);
                    }
                    if (typeof r.options.proxy.proto === 'string') {
                        r.options.proxy.proto = utils.substitute(r.options.proxy.proto, subs);
                    }
                    if (typeof r.options.proxy.auth === 'string') {
                        r.options.proxy.auth = utils.substitute(r.options.proxy.auth, subs);
                    }
                    if (typeof r.options.proxy.hash === 'string') {
                        r.options.proxy.hash = utils.substitute(r.options.proxy.hash, subs);
                    }
                    if (typeof r.options.proxy.query === 'string') {
                        r.options.proxy.query = utils.substitute(r.options.proxy.query, subs);
                    }
                    if (typeof r.options.proxy.headers === 'object' && r.options.proxy.headers !== null) {
                        for (let ph in r.options.proxy.headers) {
                            if (r.options.proxy.headers.hasOwnProperty(ph) && typeof r.options.proxy.headers[ph] === 'string') {
                                r.options.proxy.headers[ph] = utils.substitute(r.options.proxy.headers[ph], subs);
                            }
                        }
                    }
                }
            }
        }

        // Add new route to route list
        if (this.isRegexMatch === true) {
            try {
                r.regex = new RegExp(r.on, (this.isCaseSpecific === false ? 'i' : '')),
                this.routes[cnt] = r;
            } catch (reErr) {
                throw new Error(`Error while adding RegExp route #${i} (${r.on}) to the route list: ` + (reErr.message || 'Unknown'));
            }
        } else {  // Trie match
            try {
                let em = r.on.lastIndexOf('#'),
                    matchOn,
                    normMatch = (this.isCaseSpecific === true) ? r.on : r.on.toLowerCase();

                if (typeof r.postMatch === 'string' && r.postMatch.length !== 0) {
                    // We have a postMatch, so compile the RegExp for it
                    r.postMatchRE = new RegExp(r.postMatch);
                }
                if (em !== -1) {
                    // There is an end marker (#), deal with it
                    matchOn = normMatch.slice(0, em + 1);
                    this.trie.add(matchOn, r);
                    if (normMatch.length >= em) {
                        // There is a control value after the marker
                        if (normMatch.charAt(em + 1) === '?') {
                            // #? means end match or add trailing slash without end marker
                            matchOn = normMatch.slice(0, em) + '/';
                            this.trie.add(matchOn, r);
                        } else if (normMatch.charAt(em + 1) === 's' && normMatch.charAt(em - 1) !== '/') {
                            // #s means also match trailing slash with end marker
                            matchOn = normMatch.slice(0, em) + '/#';
                            this.trie.add(matchOn, r);
                        } else if (normMatch.charAt(em + 1) === 'i') {
                            // #i means also match trailing slash and /index.html, each with end markers
                            if (normMatch.charAt(em - 1) !== '/') {
                                matchOn = normMatch.slice(0, em) + '/#';
                                this.trie.add(matchOn, r);
                            }
                            matchOn = normMatch.slice(0, em) + '/index.html#';
                            this.trie.add(matchOn, r);
                        }
                    }
                } else {
                    this.trie.add(normMatch, r);
                }
            } catch (trErr) {
                throw new Error(`Error while adding route #${i} (${r.on}) to the Trie: ` + (trErr.message || 'Unknown'));
            }
        }
        cnt++;  // Bump up the route counter
    }

    // Processed successfully
    this.count = cnt;
}


/**
 * Prepare and validate a redirect route
 *
 * @memberof RouteTable
 * @private
 * @param {object} route - The route object
 * @param {object} subs - Use for substitutions if not null
 */
RouteTable.prototype.prepRedirectRoute = function (route, subs) {
    let urlObj = parseUrl(route.redirect);

    // Verify the redirect is to a valid URL
    if (!(urlObj.host || urlObj.pathname)) {
        throw new Error(`Invalid redirect rule for "${route.on}", bad redirect destination URL: ${route.redirect}`);
    }

    // Verify the geoTargeting
    if (typeof route.geoTarget === 'object' && route.geoTarget !== null) {
        let geoTarget = {};
        for (let geo in route.geoTarget) {
            if (route.geoTarget.hasOwnProperty(geo)) {
                let newGeo = geo.toUpperCase();
                // Replace static/domestic/international hostname in redirect, as appropriate
                geoTarget[newGeo] = route.geoTarget[geo];
                if (subs !== null && geoTarget[newGeo].charAt(0) === '%') {
                    geoTarget[newGeo] = utils.substitute(geoTarget[newGeo], subs);
                }
                if ((newGeo.search(/^[A-Z]{2}$/) !== -1) || Array.isArray(continents[newGeo]) || Array.isArray(regions[newGeo])) {
                    urlObj = parseUrl(geoTarget[newGeo]);
                    if (!(urlObj.host || urlObj.pathname)) {
                        throw new Error(`Invalid redirect rule for "${route.on}", bad geoTarget (${geo}) redirect destination URL: ${geoTarget[newGeo]}`);
                    }
                }
            }
        }
        route.geoTarget = geoTarget;
    } else {
        route.geoTarget = null;
    }

    // Set the redirect code (defaultCode by default)
    route.code = (typeof route.code !== 'undefined' && route.code >= 300 && route.code < 400) ? route.code : this.defaultRedirectCode;
    // Keep the parameters (false by default)
    route.keepParams = (typeof route.keepParams === 'boolean') ? route.keepParams : false;
};


/**
 * Prepare and validate a rewrite route
 *
 * @memberof RouteTable
 * @private
 * @param {object} route - The route object
 */
RouteTable.prototype.prepRewriteRoute = function (route) {
    try {
        if (typeof route.rewrite !== 'string' || route.rewrite.length === 0) {
            throw new Error('Missing or invalid rewrite pattern.');
        }
        route.pattern = new RegExp(route.rewrite);
        route.port = (typeof route.port === 'number' && route.port > 0 && route.port < 65536) ? route.port : 0;
        if (typeof route.redirectCode !== 'number') {
            route.redirectCode = 0;
        } else if (route.redirectCode !== 0 && (route.redirectCode < 301 || route.redirectCode > 308)) {
            throw new Error('Invalid redirect code.');
        }
        if (typeof route.matchParams === 'undefined') {
            route.matchParams = false;
        }
        if (typeof route.replace === 'undefined') {
            route.replace = '';
        }
        if (route.replace.search(/^(http|https)\:/i) !== -1 && route.redirectCode === 0) {
            route.redirectCode = this.defaultRedirectCode;
        }
        if (typeof route.status !== 'number') {
            route.status = 0;
        } else if (route.status !== 0 && (route.status < 400 || route.status > 505)) {
            throw new Error('Invalid status code.');
        }
        if (typeof route.isLast !== 'boolean') {
            route.isLast = false;
        }
    } catch (error) {
        throw new Error(`Rewrite rule error (${route.on}): ${error.message}`);
    }
};


/**
 * Check request hostname against host matching regex
 * if applicable, and return the case corrected and adjusted path key.
 *
 * @memberof RouteTable
 * @private
 * @param {object} req - The request object (RomRequest)
 * @returns {string|boolean} - The normalized path key or boolean false if no match
 */
RouteTable.prototype.checkBasicsAndNormalizePath = function (req) {
    return (this.isCaseSpecific === true ? req.path : req.normalizedPath) + (this.matchUsingQueryParams === true ? '?' + req.query : '');
};


/**
 * Handle forced protocol redirect
 *
 * @memberof RouteTable
 * @private
 * @param {object} req - The request object (RomRequest)
 * @param {object} route - The route object
 * @param {object} _args - Arguments from the route match
 * @returns {boolean} - true if handled, false if not
 */
RouteTable.prototype.handleProtocolRedirect = function (req, route, _args) {
    let url = formatUrl({
        auth: req.auth,
        hash: req.hash,
        hostname: req.hostname,
        pathname: req.path,
        port: route.forcePort,
        protocol: route.forceProto,
        search: route.query
    });

    req.log.debug(`Forced protocol redirect ${req.url} => ${route.forceProto.toUpperCase()}`);
    req.redirect(301, url);
    return true;  // Handled
};


/**
 * Handle matched redirect
 *
 * @memberof RouteTable
 * @private
 * @param {object} req - The request object (RomRequest)
 * @param {object} route - The route object
 * @param {object} args - Arguments from the route match
 * @returns {boolean} - true if handled, false if not
 */
RouteTable.prototype.handleMatchedRedirect = function (req, route, args) {
    let qString = '';

    if (route.keepParams === true) {
        let qIndex = req.url.indexOf('?');
        if (qIndex !== -1) {
            qString = req.url.substr(qIndex);
        }
    }

    if (route.geoTarget !== null) {
        let pageConts = '',
            pageRegs = '',
            pageString;

        req.log.debug(`{args.key} => (geotargeted) default is ${route.redirect}${qString} (${route.code})`);
        pageString = `<!DOCTYPE html><html><head><noscript><meta http-equiv="refresh" content="0;url=${route.redirect}></noscript><script>(function (d,w) {\ntry{\nvar a=d.cookie.match(/(^|;)\\s*countryCode\\s*=\\s*([^;]*)/), cc=(a?a[2]:""), rc=${route.code}, l="${route.redirect}";\nfunction isin(v,x) { for(var i=0;i<x.length;i++) { if(x[i]===v) { return true; } } return false; }\nif(cc==="") {}\n`;
        for (let geo in route.geoTarget) {
            if (route.geoTarget.hasOwnProperty(geo)) {
                if (geo.length === 2) {
                    pageString += `else if(cc==="${geo}") { l="${route.geoTarget[geo]}${qString}"; }\n`;
                } else if (typeof regions[geo] !== 'undefined') {
                    pageRegs += `else if(isin(cc,["${regions[geo].join('","')}"])) { l="${route.geoTarget[geo]}${qString}"; }\n`;
                } else if (typeof continents[geo] !== 'undefined') {
                    pageConts += `else if(isin(cc,["${continents[geo].join('","')}"])) { l="${route.geoTarget[geo]}${qString}"; }\n`;
                } else {
                    this.log.warn(`Bad geotargeting value for "${args.key}": ${geo}`);
                }
            }
        }
        req.send(200, pageString + pageRegs + pageConts + `w.location.replace(l);\n}catch(e){w.location.replace("${route.redirect}${qString}");}\n})(document,window);\n</script></head><body>&nbsp;</body></html>`);
    } else {
        // Send conventional redirect
        req.log.debug(`${args.key} => {$route.redirect}${qString} ${route.code}`);
        req.redirect(route.code, route.redirect + qString);
    }
    return true;  // Handled
};


/**
 * Handle matched rewrite
 *
 * @memberof RouteTable
 * @private
 * @param {object} req - The request object (RouteOMatic)
 * @param {object} route - The route object
 * @param {object} _args - Arguments from the route match
 * @returns {boolean} - True if handled, false to continue processing
 */
RouteTable.prototype.handleMatchedRewrite = function (req, route, _args) {
    try {
        let matchOn = (route && route.on) || '???',
            origParams,
            origPath = req.path,
            origUrl = req.url,
            params,
            path = origPath,
            qpos = req.url.indexOf('?'),
            url = origUrl;

        origParams = (qpos !== -1 ? req.url.substring(qpos + 1) : '');
        params = origParams;

        // We match and have acceptable host/port/proto
        if (route.status !== 0) {
            // No actual rewrite needed, just return status code and finish up
            req.log.debug(`rule "${matchOn}" matched: ${url} => [${route.status}]`);
            req.send(route.status, '');
            return true;  // Handled
        }

        if (route.matchParams) {
            url = url.replace(route.pattern, route.replace);
            qpos = url.indexOf('?');
            path = qpos !== -1 ? url.substr(0, qpos) : url;
            params = qpos !== -1 ? url.substr(qpos + 1) : '';
        } else {
            url = path.replace(route.pattern, route.replace);
            qpos = url.indexOf('?');

            if (qpos !== -1) {
                path = url.substr(0, qpos);

                if (params !== '') {
                    url += '&' + params;
                }
                params = url.substr(qpos + 1);
            } else {
                path = url;

                if (params !== '') {
                    qpos = path.length;
                    url += '?' + params;
                }
            }
        }

        if (route.redirectCode !== 0) {
            req.log.debug(`rule "{$matchOn}" matched: ${req.url} => ${url} [${route.redirectCode}]`);
            req.redirect(route.redirectCode, url);
            return true;  // Handled
        } else {
            req.log.debug(`rule "${matchOn}" matched: ${req.url} => ${url}`);
        }

        if (url !== origUrl) {
            // Update the request object with rewritten details
            req.url = url;

            if (params !== origParams) {
                // Update query parameters
                req.query = {};
                params.split('&').forEach(function handleParam(param) {
                    let epos = param.indexOf('=') + 1;

                    if (epos > 0) {
                        req.query[param.substr(0, epos - 1)] = param.substr(epos);
                    } else {
                        req.query[param] = true;
                    }
                });
            }
            req.rewrite(url);
            return true;
        }
    } catch (err) {
        req.log.error(`Rewrite failure - ${err.message}`);
        req.error(500);
        return true;
    }

    return false;
};


/**
 * Check regex routes
 *
 * @memberof RouteTable
 * @private
 * @param {object} req - The request object
 * @returns {boolean} - True if route matched, false if not
 */
RouteTable.prototype.checkRegexRoutes = function (req) {
    let key;

    // First, verify the hostname matches and the request path matches the base path, getting the path key
    key = this.checkBasicsAndNormalizePath(req);
    if (key === false) {
        return false;
    }

    for (let i = 0, rl = this.routes.length; i < rl; i++) {
        let r = this.routes[i],
            m = key.match(r.regex);

        if (m !== null && utils.doRuntimeChecks(req, r) === true) {
            let args = {};
            for (let j = 0, ml = m.length; j < ml; j++) {
                args[j] = m[j];
            }
            args.key = key;
            try {
                req.log.debug(`Request matched route for "${r.on}" in route-table ${this.id}`);
                if (r.forceProto.length !== 0 && req.proto !== r.forceProto) {
                    // Force proto is set to not what we are using, so we need to redirect...
                    return this.handleProtocolRedirect(req, r, args);
                }
                return r.action(req, r, args);
            } catch (err) {
                req.log.error(`Error in handler for route matching "${r.on}" with URL ${req.href}: ${err.message}`);
                req.error(500);
                return true;
            }
        }
    }

    return false;
};


/**
 * Check Trie routes
 *
 * @memberof RouteTable
 * @private
 * @param {object} req - The request object
 * @returns {object} - null if no match, status and page data otherwise
 */
RouteTable.prototype.checkTrieRoutes = function (req) {
    let key,
        result;

    // First, verify the request path matches the base path, getting the path key
    key = this.checkBasicsAndNormalizePath(req);
    if (key === false || key.length === 0) {
        return false;
    }

    // Check the Trie for a match
    result = this.trie.find(key, req);
    if (result !== null) {
        let args = {
            0: result.match,
            1: key.slice(result.match.length),
            key: key
        };

        if (typeof result.data.postMatchRE === 'object' && result.data.postMatchRE !== null &&
            result.data.postMatchRE instanceof RegExp && args[1].search(result.data.postMatchRE) === -1) {

            // The postMatch option was set and it did not match, so fail this
            return false;
        }

        try {
            req.log.debug(`Request matched route for "${result.data.on}" in route-table ${this.id}`);
            if (result.forceProto.length !== 0 && req.proto !== result.forceProto) {
                // Force proto is set to not what we are using, so we need to redirect...
                this.handleProtocolRedirect(req, result, args);
            } else {
                result.data.action(req, result.data, args);
            }
        } catch (err) {
            req.log.error(`Error in handler for route matching "${result.data.on}" with URL ${req.href}: ${err.message}`);
            req.error(500);
        }
        return true;
    }
    return false;
};


/**
 * Return the correct route resolver
 *
 * @memberof RouteTable
 * @public
 * @returns {function} - The route resolver function to use
 */
RouteTable.prototype.getResolver = function () {
    return this.resolver;
};


module.exports = RouteTable;
