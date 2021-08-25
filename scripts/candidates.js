/*
 *
 * Candidate blocks via GetMiningCandidate
 *
 */

// Import Required Modules
const bignum = require('bignum');
const util = require('./util.js');
const Transactions = require('./transactions.js');
const algorithms = require('./algorithms.js');
const versionRolling = require('./stratum/version_rolling');

// MiningTemplate Main Function
const MiningCandidate = function (jobId, rawRpcData, extraNoncePlaceholder, options) {
  // Decorate rawRpcData to make it property-compatible with getblocktemplate rpcData
  const rpcData = Object.assign(rawRpcData,
    {
      previousblockhash: rawRpcData.prevhash,
      coinbasevalue: rawRpcData.coinbaseValue,
      coinbaseaux: { flags: false },
      bits: rawRpcData.nBits,
      curtime: rawRpcData.time
    });

  // Establish Block Variables
  this.rpcData = rpcData;
  this.jobId = jobId;
  this.submits = [];

  // Calculate Block Target/Difficulty
  this.target = rpcData.target ? bignum(rpcData.target, 16) : util.bignumFromBitsHex(rpcData.bits);
  const { diff1 } = algorithms[options.coin.algorithm];
  this.difficulty = parseFloat((diff1 / this.target.toNumber()).toFixed(9));

  // Create Generation Transaction
  function createGeneration(rpcDataArg, extraNoncePlaceholderArg, optionsArg) {
    const transactions = new Transactions();
    switch (options.coin.algorithm) {
      default:
        return transactions.bitcoin(rpcDataArg, extraNoncePlaceholderArg, optionsArg);
    }
  }

  // Establish Block Historical Hashes
  this.prevHashReversed = util.reverseByteOrder(Buffer.from(rpcData.previousblockhash, 'hex')).toString('hex');

  // Push Submissions to Array
  this.registerSubmit = function (extraNonce1, extraNonce2, nTime, nonce, versionRollingBits) {
    const submission = extraNonce1 + extraNonce2 + nTime + nonce + versionRollingBits;
    if (this.submits.indexOf(submission) === -1) {
      this.submits.push(submission);
      return true;
    }
    return false;
  };

  // Establish Merkle Variables
  this.merkleBranch =
    this.rpcData.merkleProof.map((step) => util.reverseBuffer(Buffer.from(step, 'hex')));
  this.merkleBranchHex = this.merkleBranch.map((step) => step.toString('hex'));

  // Structure Block Transaction Data
  this.generation = createGeneration(rpcData, extraNoncePlaceholder, options);

  // Serialize Block Coinbase
  this.serializeCoinbase = function (extraNonce1, extraNonce2, optionsArg) {
    switch (optionsArg.coin.algorithm) {
      default:
        return Buffer.concat([
          this.generation[0],
          extraNonce1,
          extraNonce2,
          this.generation[1],
        ]);
    }
  };

  // Serialize Block Headers
  this.serializeHeader = function (merkleRoot, nTime, nonce, version, optionsArg) {
    const headerBuf = Buffer.alloc(80);
    let position = 0;
    switch (optionsArg.coin.algorithm) {
      default:
        headerBuf.write(nonce, position, 4, 'hex');
        headerBuf.write(this.rpcData.bits, position += 4, 4, 'hex');
        headerBuf.write(nTime, position += 4, 4, 'hex');
        headerBuf.write(merkleRoot, position += 4, 32, 'hex');
        headerBuf.write(this.rpcData.previousblockhash, position += 32, 32, 'hex');
        headerBuf.writeUInt32BE(version, position + 32);
        return util.reverseBuffer(headerBuf);
    }
  };

  // Serialize and return the crafted block header, and also return
  // a continuation function for constructing the full solution to submit if desired
  this.startSolution = function (coinbaseBuffer, merkleRoot, nTime, nonce, versionRollingBits, optionsArg) {
    const version = (this.rpcData.version & ~versionRolling.maxMaskBits) | versionRollingBits;
    const headerBuffer = this.serializeHeader(merkleRoot, nTime, nonce, version, optionsArg);
    const finishSolution = function () {
      return {
        id: this.rpcData.id,
        nonce: parseInt(nonce, 16),
        coinbase: coinbaseBuffer.toString('hex'),
        time: parseInt(nTime, 16),
        version
      };
    }.bind(this);
    return [headerBuffer, finishSolution];
  };

  // Get Current Job Parameters
  this.getJobParams = function (optionsArg) {
    switch (optionsArg.coin.algorithm) {
      default:
        if (!this.jobParams) {
          this.jobParams = [
            this.jobId,
            this.prevHashReversed,
            this.generation[0].toString('hex'),
            this.generation[1].toString('hex'),
            this.merkleBranchHex,
            util.packInt32BE(this.rpcData.version & ~versionRolling.maskMaxBits).toString('hex'),
            this.rpcData.bits,
            util.packUInt32BE(this.rpcData.curtime).toString('hex'),
            true,
          ];
        }
        return this.jobParams;
    }
  };

  this.hasSameParent = function (other) {
    return this.rpcData.previousblockhash === other.prevhash;
  };

  this.hasSameDifficulty = function (other) {
    return this.rpcData.bits === other.nBits;
  };

  this.isMoreRecent = function (other) {
    return this.rpcData.height > other.height;
  };
};

// Export BlockTemplate
module.exports = MiningCandidate;
