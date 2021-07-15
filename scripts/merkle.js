/*
 *
 * Merkle (Updated)
 *
 */

// Import Required Modules
const util = require('./util.js');

// Merkle Main Function
const Merkle = function (txHashArray) {
  // Concat Hashes Together
  function concatHash(h1, h2) {
    const joined = Buffer.concat([h1, h2]);
    const dhashed = util.sha256d(joined);
    return dhashed;
  }

  // Calculate Merkle Branch
  function calculateBranch(txHashes) {
    const inner = function (hashes, steps) {
      const len = hashes.length;
      if (len <= 1) return steps;

      steps.push(hashes[1]);
      if (len % 2) hashes.push(hashes[len - 1]);
      const next = util.range(2, len, 2).map((i) => concatHash(hashes[i], hashes[i + 1]));
      next.unshift(null);
      return inner(next, steps);
    };

    return inner(txHashes, []);
  }

  // Establish merkle branch
  this.branch = calculateBranch(txHashArray);
};

// Export Merkle
module.exports = Merkle;
