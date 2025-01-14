/**
 * @license
 * Copyright 2015 Telefonica Investigación y Desarrollo, S.A.U
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const formatters = require('./formatters');

const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const DEFAULT_LEVEL = 'INFO';

module.exports = logops();

function noop() {};

function logops(options) {
  let opts = merge({
    level: process.env.LOGOPS_LEVEL || DEFAULT_LEVEL,
    format: formatters[process.env.LOGOPS_FORMAT] || (process.env.NODE_ENV === 'development' ?
      formatters.dev :
      formatters.json
    ),
    getContext: noop,
    stream: process.stdout,
  }, options);

  let API = {};
  /**
   * Internal private function that implements a decorator to all
   * the level functions.
   *
   * @param {String} level one of
   *   ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
   */
  function logWrap(level) {
    return function log() {
      let context, message, args, trace, err;

      if (arguments[0] instanceof Error) {
        // log.<level>(err, ...)
        context = API.getContext();
        args = Array.prototype.slice.call(arguments, 1);
        if (!args.length) {
          // log.<level>(err)
          err = arguments[0];
          message = err.name + ': ' + err.message;
        } else {
          // log.<level>(err, "More %s", "things")
          // Use the err as context information
          err = arguments[0];
          message = arguments[1];
          args = Array.prototype.slice.call(args, 1);
        }
      } else if (arguments[0] == null || (typeof (arguments[0]) !== 'object' && arguments[0] !== null) ||
          Array.isArray(arguments[0])) {
        // log.<level>(msg, ...)
        context = API.getContext();
        message = arguments[0];
        args = Array.prototype.slice.call(arguments, 1);
      } else {
        // log.<level>(fields, msg, ...)
        context = merge(API.getContext(), arguments[0]);
        message = arguments[1];
        args = Array.prototype.slice.call(arguments, 2);
      }

      trace = API.format(level, context || {}, message, args, err);
      API.stream.write(trace + '\n');
    };
  }

  /**
   * Sets the enabled logging level.
   * All the disabled logging methods are replaced by a noop,
   * so there is not any performance penalty at production using an undesired level
   *
   * @param {String} level
   */
  function setLevel(level) {
    opts.level = level;
    let logLevelIndex = levels.indexOf(opts.level.toUpperCase());

    levels.forEach((logLevel) => {
      let fn;
      if (logLevelIndex <= levels.indexOf(logLevel)) {
        fn = logWrap(logLevel);
      } else {
        fn = noop;
      }
      API[logLevel.toLowerCase()] = fn;
    });
  }

  /**
   * The exported API.
   * The following methods are added dynamically
   * API.debug
   * API.info
   * API.warn
   * API.error
   * API.fatal
   *
   * @type {Object}
   */
  API = {
    /**
     * The stream where the logger will write string traces
     * Defaults to process.stdout
     */
    stream: opts.stream,
    setStream: (stream) => {
      API.stream = stream;
    },

    /**
     * Sets the enabled logging level.
     * All the disabled logging methods are replaced by a noop,
     * so there is not any performance penalty at production using an undesired level
     *
     * @param {String} level one of the following values
     *     ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
     */
    setLevel: setLevel,

    /**
     * Gets the current log level.
     */
    getLevel: () => opts.level,

    /**
     * Gets the context for a determinate trace. By default, this is a noop that
     * you can override if you are managing your execution context with node domains
     *
     * This function must return an object with the following fields
     * {
     *   corr: {String},
     *   trans: {String},
     *   op: {String}
     * }
     *
     * If you are not using domain, you should pass the context information for
     * EVERY log call
     *
     * Both examples will produce the same trace
     *
     * Example usage not using getContext:
     *   const logger = require('logops');
     *   req.context = {
     *    corr: 'cbefb082-3429-4f5c-aafd-26b060d6a9fc',
     *    trans: 'cbefb082-3429-4f5c-aafd-26b060d6a9fc',
     *    op: 'SendEMail'
     *   }
     *   logger.info(req.context, 'This is an example');
     *
     * Example using this feature:
     *    const logger = require('logops'),
     *        domain = require('domain');
     *
     *    logger.getContext = function domainContext() {
     *        return domain.active.myCustomContext;
     *    }
     *    //...
     *
     *    logger.info('This is an example');
     *
     * @return {Object} The context object
     */
    getContext: opts.getContext,
    setContextGetter: (fn) => {
      API.getContext = fn;
    },

    /**
     * Creates a string representation for a trace.
     *
     * It checks the `LOGOPS_FORMAT` environment variable to use the built-in
     * format functions. It fallbacks to check the de-facto `NODE_ENV` env var
     * to use the `formatters.dev` when the value is `development`. Otherwise, it
     * will use the `formatters.pipe` (while in production, for example)
     *
     * Example
     *   NODE_ENV=development node index.js
     * the logger will write traces for developers
     *
     *   node index.js
     * the logger will write traces in a pipe format (assuming NODE_ENV nor
     * LOGOPS_FORMAT environment vars are defined with valid values)
     *
     *   LOGOPS_FORMAT=json node index.js
     * the logger will write json traces
     *
     * You can override this func and manage by yourself the formatting.
     *
     * @param {String} level One of the following values
     *      ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
     * @param {Object} context Additional information to add to the trace
     * @param {String} message The main message to be added to the trace
     * @param {Array} args More arguments provided to the log function
     *
     * @return {String} The trace formatted
     */
    format: opts.format,
    setFormat: (format) => {
      API.format = format;
    },
    /**
     * Return an Object containing the available formatters ("dev", "pipe", "json").
     *
     * Example using this feature to write JSON logs.
     *
     * const logger = require('logops');
     * logger.format = logger.formatters.json;
     * logger.info('This is an example')
     *
     * @return {Object} The available formatters.
     */
    formatters: formatters,

    /**
     * Creates a child logger with the this logger settings that will append the
     * passed context to the parent one (if any)
     * ```
     * let child = logger.child({hostname: 'host.local'});
     * child.info({app: 'server'}, 'Startup');
     * // {"hostname":"host.local","app":"server","time":"2015-12-23T11:47:25.862Z","lvl":"INFO","msg":"Startup"}
     * ```
     */
    child: (localContext) => {
      // the current limitation for this approach is that child
      // loggers will overwrite the parent and localcontext when
      // calling againg `child.setContextGetter(fn)` or assign a function
      // to `child.getContext = fn`
      // But as the context is specified then creating the child, we can
      // considerer it a corner case and dont optimize for the use case
      return logops({
        level: API.getLevel(),
        getContext: () => merge(API.getContext(), localContext),
        format: API.format,
        stream: API.stream,
      });
    }
  };

  setLevel(opts.level);
  return API;
}

/**
 * Merges accesible properties in two objects.
 * obj2 takes precedence when common properties are found
 *
 * @param {Object} obj1
 * @param {Object} obj2
 * @returns {{}} The merged, new, object
 */
function merge(obj1, obj2) {
  var res = {}, attrname;

  for (attrname in obj1) {
    res[attrname] = obj1[attrname];
  }
  for (attrname in obj2) {
    res[attrname] = obj2[attrname];
  }
  return res;
}
