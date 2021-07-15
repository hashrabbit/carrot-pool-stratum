// Import Required Modules
const minerId = require('./miner-id')
const util = require('./util.js');

// Generate Combined Transactions (Bitcoin)
const Transactions = function () {
  // Structure Bitcoin Protocol Transaction
  this.bitcoin = function (rpcData, extraNoncePlaceholder, options) {
    // Establish Transactions Variables [1]
    const txLockTime = 0;
    const txInSequence = 0;
    const txInPrevOutHash = '';
    const txInPrevOutIndex = 2 ** 32 - 1;
    const txVersion = options.coin.txMessages === true ? 2 : 1;

    // Establish Transactions Variables [2]
    const reward = rpcData.coinbasevalue;
    let rewardToPool = reward;
    const txOutputBuffers = [];
    const coinbaseAux = rpcData.coinbaseaux.flags ? Buffer.from(rpcData.coinbaseaux.flags, 'hex') : Buffer.from([]);
    const poolAddressScript = util.addressToScript(options.network, options.poolAddress);

    // Handle Comments if Necessary
    const txComment = options.coin.txMessages === true
      ? util.serializeString('CylonJaeger')
      : Buffer.from([]);

    // Handle ScriptSig [1]
    const scriptSigPart1 = Buffer.concat([
      util.serializeNumber(rpcData.height),
      coinbaseAux,
      util.serializeNumber(Date.now() / 1000 | 0),
      Buffer.from([extraNoncePlaceholder.length]),
    ]);

    // Handle ScriptSig [2]
    const scriptSigPart2 = util.serializeString('/CylonJaeger/');
    const bufLens = scriptSigPart1.length + extraNoncePlaceholder.length + scriptSigPart2.length;

    // Combine Transaction [1]
    const p1 = Buffer.concat([
      util.packUInt32LE(txVersion),
      util.varIntBuffer(1),
      util.uint256BufferFromHash(txInPrevOutHash),
      util.packUInt32LE(txInPrevOutIndex),
      util.varIntBuffer(bufLens),
      scriptSigPart1,
    ]);

    // Handle Block Transactions
    for (let i = 0; i < options.recipients.length; i += 1) {
      const recipientReward = Math.floor(options.recipients[i].percent * reward);
      rewardToPool -= recipientReward;
      txOutputBuffers.push(Buffer.concat([
        util.packInt64LE(recipientReward),
        util.varIntBuffer(options.recipients[i].script.length),
        options.recipients[i].script,
      ]));
    }

    // Handle Pool Transaction
    txOutputBuffers.unshift(Buffer.concat([
      util.packInt64LE(rewardToPool),
      util.varIntBuffer(poolAddressScript.length),
      poolAddressScript,
    ]));

    // Handle Witness Commitment
    if (rpcData.default_witness_commitment !== undefined) {
      const witnessCommitment = Buffer.from(rpcData.default_witness_commitment, 'hex');
      txOutputBuffers.unshift(Buffer.concat([
        util.packInt64LE(0),
        util.varIntBuffer(witnessCommitment.length),
        witnessCommitment,
      ]));
    }

    // Handle MinerId op_return
    const minerIdBuffer = minerId.generate(rpcData.height);
    txOutputBuffers.push(Buffer.concat([
      util.packInt64LE(0),
      util.varIntBuffer(minerIdBuffer.length),
      minerIdBuffer
    ]));

    // Combine All Transactions
    const outputTransactions = Buffer.concat([
      util.varIntBuffer(txOutputBuffers.length),
      Buffer.concat(txOutputBuffers),
    ]);

    // Combine Transaction [2]
    const p2 = Buffer.concat([
      scriptSigPart2,
      util.packUInt32LE(txInSequence),
      outputTransactions,
      util.packUInt32LE(txLockTime),
      txComment,
    ]);

    // Return Generated Transaction
    return [p1, p2];
  };
};

// Export Transactions
module.exports = Transactions;
