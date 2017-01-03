# CNN Route-O-Matic

This is a library for use with [ExpressJS](http://expressjs.com)-based web servers to provide
an extremely versatile routing system.

The Route-O-Matic uses a single configuration set to allow complete build-time OR run-time
configuration of hostnames and routes supported by the server.  Furthermore, the hosts and
routes can be changed at any time without requiring a restart of the server.

The library consists of four primary components:

1. The main Route-O-Matic library itself (lib/routeomatic.js), all that needs to be included
   for use.
2. The Host-Table library (lib/host-table.js), which provides the virtual host functionality.
3. The Route-Table library (lib/route-table.js), which provides the route table parsing and
   resolving functionality.
4. The RouteOMatic-Request, or ROM-Request, library (lib/rom-request.js), which provides a
   new request object for use with Route-O-Matic route handling functions.


A brief rundown of some key features:

* Fully run-time configurable and re-configurable.
* Supports any number of virtual hosts with unique or shared route tables.
* Route tables can use regular expressions or much faster prefix tree/Trie-based logic.
* Ability to define a default host to use for unconfigured host names.
* Redirects, rewrites, handled routes are all configured as "routes".
* Built-in easy to use proxy logic.


