'use strict';

var normalize = require('path').normalize;

module.exports = function (grunt) {
    // Load tasks
    grunt.loadNpmTasks('grunt-eslint');

    // Config tasks
    grunt.initConfig({
        eslint: {
            target: {
                src: [
                    /* include */
                    'lib/**/*.js',

                    /* exclude */
                    '!node_modules/**/*.js',
                    '!docs/**/*.js'
                ]
            },
            options: {
                configFile: './.eslintrc.json'
            }
        }
    });

    // Register tasks
    grunt.registerTask('test', ['eslint']);
    grunt.registerTask('default', ['test']);
};
