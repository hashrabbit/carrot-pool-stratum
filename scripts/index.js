/*
 *
 * Index (Updated)
 *
 */

// Import Required Modules
require('net');
require('events');

// Load Hashing Algorithms
require('./algorithms.js');

// Establish Main Pool Exports
const Pool = require('./pool.js');
exports.daemon = require('./daemon.js');
exports.difficulty = require('./difficulty.js');

exports.createPool = function (poolOptions, authorizeFn) {
  const newPool = new Pool(poolOptions, authorizeFn);
  return newPool;
};
