/**
 * Super simple HTTP/HTTPS extended error type
 *
 * Really just a normal JS Error with an additional "statusCode" reflecting
 * the HTTP error code.  Also defaults the message to the default HTTP error
 * message for that code if no message is provided.
 *
 * @module http-error
 */

'use strict';


var errorCodes = {
    100: 'Continue',
    101: 'Switching Protocols',
    102: 'Processing',
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    203: 'Non-Authoritative Information',
    204: 'No Content',
    205: 'Reset Content',
    206: 'Partial Content',
    207: 'Multi-Status',
    208: 'Already Reported',
    226: 'IM Used',
    300: 'Multiple Choices',
    301: 'Moved Permanently',
    302: 'Moved Temporarily',
    303: 'See Other',
    304: 'Not Modified',
    305: 'Use Proxy',
    306: 'Switch Proxy',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Payload Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Range Not Satisfiable',
    417: 'Expectation Failed',
    418: 'I\'m a teapot',
    421: 'Misdirected Request',
    422: 'Unprocessable Entity',
    423: 'Locked',
    424: 'Failed Dependency',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    508: 'Loop Detected',
    510: 'Not Extended',
    511: 'Network Authentication Required'
};


/**
 * Utility function to return default error text for a specific error code
 *
 * @function
 * @private
 * @param {number} code - The error code to use
 * @returns {string} - The error message for the given code
 */
function getErrorMessage(code) {
    return (typeof errorCodes[code] === 'string') ? errorCodes[code] : 'Unknown';
}


/**
 * HttpError Object constructor
 *
 * @constructor
 * @memberof http-error
 * @param {string|number} message - Error message, or error status code (if number).
 * @param {number} [status] - Error status code (if not set with message).
 */
function HttpError(message, status) {
    var lpart = (new Error()).stack.match(/[^\s]+$/);

    if (typeof message === 'number') {
        status = message;
        message = undefined;
    } else if (typeof status === 'number' || Number(status) > 0) {
        status = Number(status);
    } else if (typeof message === 'string' && (status = parseInt(message, 10)) > 0) {
        message = (message.length > 3) ? message : undefined;
    }
    this.statusCode = (status > 0 && status < 600) ? status : 500;
    this.message = (typeof message === 'string') ? message : getErrorMessage(this.statusCode);
    this.stack = `${this.name} at ${lpart}`;
}

Object.setPrototypeOf(HttpError, Error);
HttpError.prototype = Object.create(Error.prototype);
HttpError.prototype.name = 'HttpError';
HttpError.prototype.message = '';
HttpError.prototype.statusCode = 0;
HttpError.prototype.constructor = HttpError;

module.exports = HttpError;

