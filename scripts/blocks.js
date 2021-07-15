/*
 *
 * Blocks (Updated)
 *
 */

// Import Required Modules
const bignum = require('bignum');
const util = require('./util.js');

// Import Required Modules
const Merkle = require('./merkle.js');
const Transactions = require('./transactions.js');
const algorithms = require('./algorithms.js');

// BlockTemplate Main Function
const BlockTemplate = function (jobId, rpcData, extraNoncePlaceholder, options) {
  // Establish Block Variables
  this.rpcData = rpcData;
  this.jobId = jobId;
  this.submits = [];

  // Calculate Block Target/Difficulty
  this.target = rpcData.target ? bignum(rpcData.target, 16) : util.bignumFromBitsHex(rpcData.bits);
  const { diff1 } = algorithms[options.coin.algorithm];
  this.difficulty = parseFloat((diff1 / this.target.toNumber()).toFixed(9));

  // Function to get Transaction Buffers
  function getTransactionBuffers(txs) {
    const txHashes = txs.map((tx) => {
      if (tx.txid !== undefined) {
        return util.uint256BufferFromHash(tx.txid);
      }
      return util.uint256BufferFromHash(tx.hash);
    });
    return [null].concat(txHashes);
  }

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
  if (rpcData.finalsaplingroothash) {
    this.hashReserved = util.reverseBuffer(Buffer.from(rpcData.finalsaplingroothash, 'hex')).toString('hex');
  } else {
    this.hashReserved = '0000000000000000000000000000000000000000000000000000000000000000';
  }

  // Push Submissions to Array
  this.registerSubmit = function (extraNonce1, extraNonce2, nTime, nonce) {
    const submission = extraNonce1 + extraNonce2 + nTime + nonce;
    if (this.submits.indexOf(submission) === -1) {
      this.submits.push(submission);
      return true;
    }
    return false;
  };

  // Establish Merkle Variables
  this.merkleBranch = new Merkle(getTransactionBuffers(rpcData.transactions)).branch;
  this.merkleBranchHex = this.merkleBranch.map((step) => step.toString('hex'));

  // Structure Block Transaction Data
  this.generation = createGeneration(rpcData, extraNoncePlaceholder, options);
  this.transactions = Buffer.concat(rpcData.transactions.map((tx) => Buffer.from(tx.data, 'hex')));

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
  this.serializeHeader = function (merkleRoot, nTime, nonce, optionsArg) {
    const headerBuf = Buffer.alloc(80);
    let position = 0;
    switch (optionsArg.coin.algorithm) {
      default:
        headerBuf.write(nonce, position, 4, 'hex');
        headerBuf.write(this.rpcData.bits, position += 4, 4, 'hex');
        headerBuf.write(nTime, position += 4, 4, 'hex');
        headerBuf.write(merkleRoot, position += 4, 32, 'hex');
        headerBuf.write(this.rpcData.previousblockhash, position += 32, 32, 'hex');
        headerBuf.writeUInt32BE(this.rpcData.version, position + 32);
        return util.reverseBuffer(headerBuf);
    }
  };

  // Serialize Entire Block
  this.serializeBlock = function (header, coinbase, optionsArg) {
    switch (optionsArg.coin.algorithm) {
      default:
        return Buffer.concat([
          header,
          util.varIntBuffer(this.rpcData.transactions.length + 1),
          coinbase,
          this.transactions,
          Buffer.from([]),
        ]);
    }
  };

  // Serialize and return the crafted block header, and also return
  // a continuation function for constructing the full solution to submit if desired
  this.startSolution = function (coinbaseBuffer, merkleRoot, nTime, nonce, optionsArg) {
    const headerBuffer = this.serializeHeader(merkleRoot, nTime, nonce, optionsArg);
    const finishSolution = function () {
      return this.serializeBlock(headerBuffer, coinbaseBuffer, optionsArg).toString('hex');
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
            util.packInt32BE(this.rpcData.version).toString('hex'),
            this.rpcData.bits,
            util.packUInt32BE(this.rpcData.curtime).toString('hex'),
            true,
          ];
        }
        return this.jobParams;
    }
  };

  this.hasSameParent = function (other) {
    return this.rpcData.previousblockhash === other.previousblockhash;
  };

  this.hasSameDifficulty = function (other) {
    return this.rpcData.bits === other.bits;
  };

  this.isMoreRecent = function (other) {
    return this.rpcData.height > other.height;
  };
};

// Export BlockTemplate
module.exports = BlockTemplate;
