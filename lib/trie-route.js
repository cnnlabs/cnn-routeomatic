'use strict';

var doRuntimeChecks = require('./utils').doRuntimeChecks;


/**
 * TrieRoute Object constructor
 *
 * @constructor
 * @memberof TrieRoute
 */
function TrieRoute() {
    this.trie = {};
}


/**
 * Add a path/controller to a trie
 * @memberof TrieRoute
 * @public
 * @param {string} path - The path to add to the trie, matched as a substring unless it ends with '#'
 * @param {varies} data - The object or function to return when this pattern is matched
 * @throws Error on failure
 */
TrieRoute.prototype.add = function (path, data) {
    function inject(word, node, depth) {
        let first = word.charAt(depth);

        // If at end of pattern
        if (first === '#' || word.length === depth) {
            let val = (first === '#') ? '|X' : '|W';  // |W = substring match, |X = full string

            if (!(val in node)) {
                node[val] = {};
            }
            if (typeof node[val].val !== 'undefined') {
                throw new Error(`Duplicate or overlapping route!  Failed to add "${path}" because another route resolves the same path or a substring of it (at char ${depth}).`);
            } else {
                node[val].val = data;
            }
        } else {
            if (!(first in node)) {
                node[first] = {};
            }
            inject(word, node[first], depth + 1);
        }
    }

    if (typeof path === 'undefined' || path === null || path === '') {
        throw new Error('Invalid blank/empty route.  Failed to add.');
    }
    inject(path, this.trie, 0);
};


/**
 * Search the trie to see if a match for the given path is found.
 * @memberof TrieRoute
 * @public
 * @param {string} path - The path to find in the trie
 * @param {object} req - The request object to use to compare hostname/protocol, if necessary
 * @returns {object} - The match object on match or null if no match
 */
TrieRoute.prototype.find = function (path, req) {
    function parseWord(word, node, depth) {
        let idx;

        if ('|W' in node && doRuntimeChecks(req, node['|W'].val) === true) {
            // Substring match, we don't need to look any farther
            return {
                data: node['|W'].val,
                match: word.slice(0, depth)
            };
        }
        idx = word.charAt(depth);
        if (idx === '') {
            // Complete word match or not
            if ('|X' in node && doRuntimeChecks(req, node['|X'].val) === true) {
                return {
                    data: node['|X'].val,
                    match: word.slice(0, depth)
                };
            }
            return null;
        }
        return (idx in node) ? parseWord(word, node[idx], depth + 1) : null;
    }

    return (typeof path === 'string' && path.length !== 0) ? parseWord(path, this.trie, 0) : null;
};


module.exports = TrieRoute;

