/*
 *
 * Manager (Updated)
 *
 */

// Import Required Modules
const events = require('events');
const crypto = require('crypto');
const bignum = require('bignum');
const algorithms = require('./algorithms');
const util = require('./util');

// Import BlockTemplate Module
const BlockTemplate = require('./blocks');
// Import MiningCandidate Module
const MiningCandidate = require('./candidates');

// Generate Unique ExtraNonce for each Subscriber
const ExtraNonceCounter = function (configInstanceId) {
  const instanceId = configInstanceId || crypto.randomBytes(4).readUInt32LE(0);
  let counter = instanceId << 27;
  this.size = 4;
  this.next = function () {
    const extraNonce = util.packUInt32BE(Math.abs(counter));
    counter += 1;
    return extraNonce.toString('hex');
  };
};

// Generate Unique Job for each Block
const JobCounter = function () {
  let counter = 0;
  this.next = function () {
    counter += 1;
    if (counter % 0xffff === 0) counter = 1;
    return this.cur();
  };
  this.cur = function () {
    return counter.toString(16);
  };
};

/**
 * Emits:
 * - newBlock(BlockTemplate) - When a new block (previously unknown to the JobManager) is added,
 *                             use this event to broadcast new jobs
 * - share(shareData, blockHex) - When a worker submits a share,
 *                                it will have blockHex if a block was found
* */

// Manager Main Function
const Manager = function (options) {
  // Establish Private Manager Variables
  const _this = this;
  const jobCounter = new JobCounter();
  const shareMultiplier = algorithms[options.coin.algorithm].multiplier;
  const hashDigest = algorithms[options.coin.algorithm].hash(options.coin);
  const { diff1 } = algorithms[options.coin.algorithm];
  const BlockBuilder = options.extensions.miningCandidateApi ? MiningCandidate : BlockTemplate;

  // Establish Public Manager Variables
  this.currentJob = undefined;
  this.validJobs = {};
  this.extraNonceCounter = new ExtraNonceCounter(options.instanceId);
  this.extraNoncePlaceholder = Buffer.from('f000000ff111111f', 'hex');
  this.extraNonce2Size = this.extraNoncePlaceholder.length - this.extraNonceCounter.size;

  // Determine Block Hash Function
  function blockHash() {
    switch (options.coin.algorithm) {
      default:
        return function (d) {
          return util.reverseBuffer(util.sha256d(d));
        };
    }
  }

  // Determine Coinbase Hash Function
  function coinbaseHash() {
    switch (options.coin.algorithm) {
      default:
        return util.sha256d;
    }
  }

  // Establish Main Hash Functions
  const blockHasher = blockHash();
  const coinbaseHasher = coinbaseHash();

  // Update Current Managed Job
  function updateCurrentJob(rpcData) {
    const tmpBlockTemplate = new BlockBuilder(
      jobCounter.next(),
      rpcData,
      _this.extraNoncePlaceholder,
      options,
    );
    _this.currentJob = tmpBlockTemplate;
    _this.emit('updatedBlock', tmpBlockTemplate, true);
    _this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;
  }

  // Check if New Block is Processed
  this.updateCurrentJob = updateCurrentJob;

  this.processBlock = function (rpcData) {
    // When given a fresh job, updates the current job and returns true
    // When given a stale job, returns false

    const hasCurrentJob = typeof (_this.currentJob) !== 'undefined';
    if (hasCurrentJob) {
      // Given a current job, any older block will never be a new job
      if (_this.currentJob.isMoreRecent(rpcData)) {
        return false;
      }

      // If the 'new' block has the old difficulty and parent, no need to treat it as new
      if (_this.currentJob.hasSameParent(rpcData) && _this.currentJob.hasSameDifficulty(rpcData)) {
        return false;
      }
    }

    // If we don't have a current job, or the block meets the criteria to count as the next job...
    // Update Current Managed Block
    updateCurrentJob(rpcData);
    return true;
  };

  // Process New Submitted Share
  this.processShare = function (jobId, previousPoolDifficulty, poolDifficulty, extraNonce1,
    extraNonce2, nTime, nonce, ipAddress, port, workerName) {
    // Share is Invalid
    const shareError = function (error) {
      _this.emit('share', {
        job: jobId,
        ip: ipAddress,
        worker: workerName,
        difficulty: poolDifficulty,
        port,
        error: error[1],
      });
      return { error, result: null };
    };

    // Handle Shares by Algorithm
    switch (options.coin.algorithm) {
      // Default Share Handling
      default: {
        // Edge Cases to Check if Share is Invalid
        const submitTime = Math.trunc(Date.now() / 1000);
        if (extraNonce2.length / 2 !== _this.extraNonce2Size) return shareError([20, 'incorrect size of extranonce2']);
        const job = this.validJobs[jobId];
        if (typeof job === 'undefined' || job.jobId !== jobId) {
          return shareError([21, 'job not found']);
        }
        if (nTime.length !== 8) {
          return shareError([20, 'incorrect size of ntime']);
        }
        const nTimeInt = parseInt(nTime, 16);
        if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 7200) {
          return shareError([20, 'ntime out of range']);
        }
        if (nonce.length !== 8) {
          return shareError([20, 'incorrect size of nonce']);
        }
        if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
          return shareError([22, 'duplicate share']);
        }

        // Establish Share Information
        const extraNonce1Buffer = Buffer.from(extraNonce1, 'hex');
        const extraNonce2Buffer = Buffer.from(extraNonce2, 'hex');
        const coinbaseBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer, options);
        const coinbaseHashOutput = coinbaseHasher(coinbaseBuffer);

        const merkleRoot = util.reverseBuffer(
          job.merkleBranch.reduce(
            (acc, step) => util.sha256d(Buffer.concat([acc, step])),
            coinbaseHashOutput
          )
        ).toString('hex');

        const [headerBuffer, finishSolution] = job.startSolution(
          coinbaseBuffer, merkleRoot, nTime, nonce, options
        );
        const headerHash = hashDigest(headerBuffer, nTimeInt);
        const headerBigNum = bignum.fromBuffer(headerHash, { endian: 'little', size: 32 });

        // Establish Share Variables
        let blockHashInvalid;
        let blockHeaderHash;
        let blockSolution;
        let difficulty = poolDifficulty;

        // Calculate Share Difficulty
        const shareDiff = (diff1 / headerBigNum.toNumber()) * shareMultiplier;
        const blockDiffAdjusted = job.difficulty * shareMultiplier;

        // Check if Share is Valid Block Candidate
        if (job.target.ge(headerBigNum)) {
          blockSolution = finishSolution();
          blockHeaderHash = blockHasher(headerBuffer, nTime).toString('hex');
        } else {
          if (options.emitInvalidBlockHashes) {
            blockHashInvalid = util.reverseBuffer(util.sha256d(headerBuffer)).toString('hex');
          }
          if (shareDiff / poolDifficulty < 0.99) {
            if (previousPoolDifficulty && shareDiff >= previousPoolDifficulty) {
              difficulty = previousPoolDifficulty;
            } else {
              return shareError([23, `low difficulty share of ${shareDiff}`]);
            }
          }
        }

        // Share is Valid
        _this.emit('share', {
          job: jobId,
          ip: ipAddress,
          port,
          worker: workerName,
          height: job.rpcData.height,
          blockReward: job.rpcData.coinbasevalue,
          difficulty,
          shareDiff: shareDiff.toFixed(8),
          blockDiff: blockDiffAdjusted,
          blockDiffActual: job.difficulty,
          blockHash: blockHeaderHash,
          blockHashInvalid,
        }, blockSolution);

        // Return Valid Share
        return { result: true, error: null, blockHeaderHash };
      }
    }
  };
};

// Export Manager
module.exports = Manager;
Object.setPrototypeOf(Manager.prototype, events.EventEmitter.prototype);
