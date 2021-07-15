/*
 *
 * Algorithms (Updated)
 *
 */

// Import Required Modules
const util = require('./util.js');

// Algorithms Main Function
const algorithms = {
  // Sha256 Algorithm
  sha256: {
    hash() {
      return function (...args) {
        return util.sha256d.apply(this, args);
      };
    },
    // Difficulty constant
    diff1: 0x00000000ffff0000000000000000000000000000000000000000000000000000
  },
};

// Set Default Multiplier
Object.keys(algorithms).forEach((algo) => {
  if (!algorithms[algo].multiplier) {
    algorithms[algo].multiplier = 1;
  }
});

// Export Algorithms
module.exports = algorithms;
