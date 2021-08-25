/*
 *
 * Pool (Updated)
 *
 */

// Import Required Modules
const events = require('events');
// TODO(rschifflin): Why was async required and not used? Maybe a leftover from an earlier revision
const algorithms = require('./algorithms');
const util = require('./util');

// Import Required Modules
const Difficulty = require('./difficulty.js');
const Daemon = require('./daemon.js');
const Manager = require('./manager.js');
const Peer = require('./peer.js');
const Stratum = require('./stratum');

// Pool Main Function
const Pool = function (initialOptions, authorizeFn) {
  // Establish Pool Variables
  const _this = this;
  const options = initialOptions;

  // TODO(rschifflin) Why were we declaring this interval id if we never use it?
  // let blockPollingIntervalId;
  const emitLog = function (text) { _this.emit('log', 'debug', text); };
  const emitWarningLog = function (text) { _this.emit('log', 'warning', text); };
  const emitErrorLog = function (text) { _this.emit('log', 'error', text); };
  const emitSpecialLog = function (text) { _this.emit('log', 'special', text); };

  // Check if Algorithm is Supported
  if (!(options.coin.algorithm in algorithms)) {
    emitErrorLog(`The ${options.coin.algorithm} hashing algorithm is not supported.`);
    throw new Error();
  }

  // Assign fn for getting and submitting next work block
  if (options.extensions.miningCandidateApi) { // When using the getMiningCandidate api...
    this.cmdGetBlock = (...args) => _this.daemon.cmd.apply(
      _this, ['getminingcandidate', [false]].concat(args)
    );
    this.cmdSubmitBlock = (miningSolution, ...rest) => _this.daemon.cmd.apply(
      _this, ['submitminingsolution', [miningSolution]].concat(rest)
    );
  } else { // When using the getblocktemplate api...
    this.cmdGetBlock = (...args) => {
      const fixedArgs = ['getblocktemplate', [{
        capabilities: ['coinbasetxn', 'workid', 'coinbase/append'],
        rules: ['segwit']
      }]];
      return _this.daemon.cmd.apply(_this, fixedArgs.concat(args));
    };
    this.cmdSubmitBlock = (blockHex, ...rest) => {
      let rpcCommand;
      let rpcArgs;
      if (options.hasSubmitMethod) {
        rpcCommand = 'submitblock';
        rpcArgs = [blockHex];
      } else {
        rpcCommand = 'getblocktemplate';
        rpcArgs = [{ mode: 'submit', data: blockHex }];
      }

      return _this.daemon.cmd.apply(_this, [rpcCommand, rpcArgs].concat(rest));
    };
  }

  this.cmdProcessBlock = (callback) => {
    _this.cmdGetBlock(
      (result) => {
        if (result.error) {
          emitErrorLog(`call ${result.method}
            with params ${JSON.stringify(result.params)}
            failed for daemon instance ${result.instance.index}
            with error ${JSON.stringify(result.error)}`);
          callback(result.error);
        } else {
          const isNewBlock = _this.manager.processBlock(result.response);
          callback(null, result.response, isNewBlock);
          // TODO(rschifflin): Why were we 'undefining' the callback here?
        }
      },
      true
    );
  };

  // Process Block when Found
  this.processBlockNotify = function (blockHash, sourceTrigger) {
    emitLog(`Block notification via ${sourceTrigger}`);
    // TODO(rschifflin): Why is this not flagged for line length by the linter?
    if (typeof (_this.manager.currentJob) !== 'undefined' && blockHash !== _this.manager.currentJob.rpcData.previousblockhash) {
      _this.cmdProcessBlock((error) => {
        if (error) {
          emitErrorLog(`Block notify error getting block for ${options.coin.name}`);
        }
      });
    }
  };

  // Configure Port Difficulty
  this.setDifficulty = function (port, difficultyConfig) {
    if (typeof (_this.difficulty[port]) !== 'undefined') {
      _this.difficulty[port].removeAllListeners();
    }
    const difficultyInstance = new Difficulty(port, difficultyConfig);
    _this.difficulty[port] = difficultyInstance;
    _this.difficulty[port].on('newDifficulty', (client, newDiff) => {
      client.enqueueNextDifficulty(newDiff);
    });
  };

  // Initialize Pool Difficulty
  function setupDifficulty() {
    _this.difficulty = {};
    Object.keys(options.ports).forEach((port) => {
      if (options.ports[port].difficulty) {
        _this.setDifficulty(port, options.ports[port].difficulty);
      }
    });
  }

  // Initialize Pool Daemon
  function setupDaemonInterface(callback) {
    // Check to Ensure Daemons are Configured
    if (!Array.isArray(options.daemons) || options.daemons.length < 1) {
      emitErrorLog('No daemons have been configured - pool cannot start');
      return;
    }

    // Establish Daemon
    _this.daemon = new Daemon.Interface(options.daemons, ((severity, message) => {
      _this.emit('log', severity, message);
    }));

    // Establish Online Functionality
    _this.daemon.once('online', () => {
      callback();
    });

    // Establish Failed Connection Functionality
    _this.daemon.on('connectionFailed', (error) => {
      emitErrorLog(`Failed to connect daemon(s): ${JSON.stringify(error)}`);
    });

    // Establish Error Functionality
    _this.daemon.on('error', (message) => {
      emitErrorLog(message);
    });

    // Initialize Daemon
    _this.daemon.init();
  }

  // Initialize Pool Data
  function setupPoolData(callback) {
    // Define Initial RPC Calls
    const batchRPCCommand = [
      ['validateaddress', [options.addresses.address]],
      ['getdifficulty', []],
      ['getmininginfo', []],
      // TODO(rschifflin): Make this contingent on options.extensions.miningCandidateApi
      ['submitblock', []],
    ];

    // Check if Coin has GetInfo Defined
    if (options.coin.hasGetInfo) {
      batchRPCCommand.push(['getinfo', []]);
    } else {
      batchRPCCommand.push(['getblockchaininfo', []], ['getnetworkinfo', []]);
    }

    // Manage RPC Batches
    _this.daemon.batchCmd(batchRPCCommand, (error, results) => {
      if (error || !results) {
        // TODO(rschifflin): Why is this not flagged for line length by the linter?
        emitErrorLog(`Could not start pool, error with init batch RPC call: ${JSON.stringify(error)}`);
        return;
      }

      // Check Results of Each RPC Call
      const rpcResults = {};
      for (let i = 0; i < results.length; i += 1) {
        const rpcCall = batchRPCCommand[i][0];
        const r = results[i];
        rpcResults[rpcCall] = r.result || r.error;

        if (rpcCall !== 'submitblock' && (r.error || !r.result)) {
          // TODO(rschifflin): Why is this not flagged for line length by the linter?
          emitErrorLog(`Could not start pool, error with init RPC ${rpcCall} - ${JSON.stringify(r.error)}`);
          return;
        }
      }

      // Check Pool Address is Valid
      if (!rpcResults.validateaddress.isvalid) {
        emitErrorLog('Daemon reports address is not valid');
        return;
      }

      // Check if Mainnet/Testnet is Active
      options.testnet = (rpcResults.getblockchaininfo.chain === 'test');
      options.network = (options.testnet ? options.coin.testnet
        : options.coin.mainnet);

      // Establish Coin Protocol Version
      options.poolAddress = rpcResults.validateaddress.address;
      options.protocolVersion = (options.coin.hasGetInfo
        ? rpcResults.getinfo.protocolversion
        : rpcResults.getnetworkinfo.protocolversion);
      let difficulty = options.coin.hasGetInfo ? rpcResults.getinfo.difficulty
        : rpcResults.getblockchaininfo.difficulty;
      if (typeof (difficulty) === 'object') {
        difficulty = difficulty['proof-of-work'];
      }

      // Establish Coin Initial Statistics
      options.initStats = {
        connections: (options.coin.hasGetInfo ? rpcResults.getinfo.connections
          : rpcResults.getnetworkinfo.connections),
        difficulty: difficulty * algorithms[options.coin.algorithm].multiplier,
        networkHashRate: rpcResults.getmininginfo.networkhashps,
      };

      // Check if Pool is Able to Submit Blocks
      if (rpcResults.submitblock.message === 'Method not found') {
        options.hasSubmitMethod = false;
      } else if (rpcResults.submitblock.code === -1) {
        options.hasSubmitMethod = true;
      } else {
        emitErrorLog(`Could not detect block submission RPC method, ${JSON.stringify(results)}`);
        return;
      }

      // Send Callback
      callback();
    });
  }

  // Initialize Pool Recipients
  function setupRecipients() {
    const recipients = [];
    options.feePercent = 0;
    options.rewardRecipients = options.rewardRecipients || {};
    Object.keys(options.rewardRecipients).forEach((r) => {
      const percent = options.rewardRecipients[r];
      const rObj = {
        percent: percent / 100,
      };
      try {
        if (r.length === 40) rObj.script = util.miningKeyToScript(r);
        else rObj.script = util.addressToScript(options.network, r);
        recipients.push(rObj);
        options.feePercent += percent;
      } catch (e) {
        emitErrorLog(`Error generating transaction output script for ${r} in rewardRecipients`);
      }
    });
    if (recipients.length === 0) {
      emitErrorLog('No rewardRecipients have been setup which means no fees will be taken');
    }
    options.recipients = recipients;
  }

  // Check Whether Block was Accepted by Daemon
  function checkBlockAccepted(blockHash, callback) {
    _this.daemon.cmd('getblock', [blockHash], (results) => {
      const validResults = results.filter((result) => result.response
        && (result.response.hash === blockHash));
      if (validResults.length >= 1) {
        callback(true, validResults[0].response.tx[0]);
      } else {
        callback(false);
      }
    });
  }

  // Submit Block to Stratum Server
  function submitBlock(submitArg, callback) {
    // Establish Submission Functionality
    _this.cmdSubmitBlock(submitArg,
      (results) => {
        for (let i = 0; i < results.length; i += 1) {
          const result = results[i];
          if (result.error) {
            emitErrorLog(`RPC error with daemon instance ${
              result.instance.index} when submitting block with ${result.method} ${
              JSON.stringify(result.error)}`);
            return;
          }
          if (result.response === 'rejected') {
            // TODO(rschifflin): Why is this not flagged for line length by the linter?
            emitErrorLog(`Daemon instance ${result.instance.index} rejected a supposedly valid block`);
            return;
          }

          emitLog(`Submitted Block using ${result.method} successfully to daemon instance(s)`);
        }
        callback();
      });
  }

  // Initialize Pool Job Manager
  function setupJobManager() {
    // Establish Manager
    _this.manager = new Manager(options);

    // Establish Log Functionality
    _this.manager.on('log', (severity, message) => {
      _this.emit('log', severity, message);
    });

    // Establish New Block Functionality
    _this.manager.on('newBlock', (block) => {
      if (_this.stratumServer) {
        _this.stratumServer.broadcastMiningJobs(block.getJobParams(options));
      }
    });

    // Establish Share Functionality
    _this.manager.on('share', (rawShareData, blockSolution) => {
      const shareData = rawShareData;
      const isValidShare = !shareData.error;
      let isValidBlock = !!blockSolution;
      const emitShare = function () {
        _this.emit('share', isValidShare, isValidBlock, shareData);
      };
      if (!isValidBlock) emitShare();
      else {
        submitBlock(blockSolution, () => {
          checkBlockAccepted(shareData.blockHash, (isAccepted, tx) => {
            isValidBlock = isAccepted;
            shareData.txHash = tx;
            emitShare();
            _this.cmdProcessBlock((error, result, foundNewBlock) => {
              if (foundNewBlock) emitLog('Block notification via RPC after block submission');
            });
          });
        });
      }
    });

    // Establish Updated Block Functionality
    _this.manager.on('updatedBlock', (block) => {
      if (_this.stratumServer) {
        const job = block.getJobParams(options);
        job[8] = false;
        _this.stratumServer.broadcastMiningJobs(job);
      }
    });
  }

  // Wait Until Blockchain is Fully Synced
  function syncBlockchain(syncedCallback) {
    // Calculate Current Progress on Sync
    const generateProgress = function () {
      const cmd = options.coin.hasGetInfo ? 'getinfo' : 'getblockchaininfo';
      _this.daemon.cmd(cmd, [], (getInfoResults) => {
        const sortedGetInfo = getInfoResults.sort((a, b) => b.response.blocks - a.response.blocks);
        const blockCount = sortedGetInfo[0].response.blocks;

        // Compare with Peers to Get Percentage Synced
        _this.daemon.cmd('getpeerinfo', [], (results) => {
          const peers = results[0].response;
          const sortedPeerInfo = peers.sort((a, b) => b.startingheight - a.startingheight);
          const totalBlocks = sortedPeerInfo[0].startingheight;
          const percent = ((blockCount / totalBlocks) * 100).toFixed(2);
          emitWarningLog(`Downloaded ${percent}% of blockchain from ${peers.length} peers`);
        });
      });
    };

    // Check for Blockchain to be Fully Synced
    const checkSynced = function (displayNotSynced) {
      _this.cmdGetBlock((results) => {
        // NOTE: getblocktemplate and getminingcandidate have an identical error response api
        const synced = results.every((r) => !r.error || r.error.code !== -10);
        if (synced) {
          syncedCallback();
        } else {
          if (displayNotSynced) {
            displayNotSynced();
          }
          setTimeout(checkSynced, 5000);
          if (!process.env.forkId || process.env.forkId === '0') {
            generateProgress();
          }
        }
      });
    };

    // Check and Return Message if Not Synced
    checkSynced(() => {
      if (!process.env.forkId || process.env.forkId === '0') {
        // TODO(rschifflin): Why is this not flagged for line length by the linter?
        emitErrorLog('Daemon is still syncing with network (download blockchain) - server will be started once synced');
      }
    });
  }

  // Initialize Pool First Job
  function setupFirstJob(callback) {
    // Establish First Block Template
    _this.cmdProcessBlock((error) => {
      if (error) {
        emitErrorLog('Error with getting block on creating first job, server cannot start');
        return;
      }

      // Check for Difficulty/Warnings
      const portWarnings = [];
      const networkDiffAdjusted = options.initStats.difficulty;
      Object.keys(options.ports).forEach((port) => {
        const portDiff = options.ports[port].diff;
        if (networkDiffAdjusted < portDiff) portWarnings.push(`port ${port} w/ diff ${portDiff}`);
      });
      if (portWarnings.length > 0 && (!process.env.forkId || process.env.forkId === '0')) {
        const warnMessage = `Network diff of ${networkDiffAdjusted} is lower than ${
          portWarnings.join(' and ')}`;
        emitWarningLog(warnMessage);
      }

      // Send Callback
      callback();
    });
  }

  // Initialize Pool Block Polling
  function setupBlockPolling() {
    if (typeof options.blockRefreshInterval !== 'number'
      || options.blockRefreshInterval <= 0) {
      emitLog('Block template polling has been disabled');
      return;
    }
    const pollingInterval = options.blockRefreshInterval;
    // TODO(rschifflin) Why were we capturing the setInterval result if we never unset it?
    /* blockPollingIntervalId = */ setInterval(() => {
      _this.cmdProcessBlock((error, _result, foundNewBlock) => {
        if (foundNewBlock) emitLog('Block notification via RPC polling');
      });
    }, pollingInterval);
  }

  // Initialize Pool Peers
  function setupPeer() {
    // Check for P2P Configuration
    if (!options.p2p || !options.p2p.enabled) return;
    if (options.testnet && !options.coin.peerMagicTestnet) {
      // TODO(rschifflin): Why is this not flagged for line length by the linter?
      emitErrorLog('p2p cannot be enabled in testnet without peerMagicTestnet set in coin configuration');
      return;
    } if (!options.coin.peerMagic) {
      emitErrorLog('p2p cannot be enabled without peerMagic set in coin configuration');
      return;
    }

    // Establish Peer
    _this.peer = new Peer(options);

    // Establish Connection Functionality
    _this.peer.on('connected', () => {});
    _this.peer.on('disconnected', () => {});

    // Establish Rejected Connection Functionality
    _this.peer.on('connectionRejected', () => {
      emitErrorLog('p2p connection failed - likely incorrect p2p magic value');
    });

    // Establish Failed Connection Functionality
    _this.peer.on('connectionFailed', () => {
      emitErrorLog('p2p connection failed - likely incorrect host or port');
    });

    // Establish Socket Error Functionality
    _this.peer.on('socketError', (e) => {
      emitErrorLog(`p2p had a socket error ${JSON.stringify(e)}`);
    });

    // Establish Error Functionality
    _this.peer.on('error', (msg) => {
      emitWarningLog(`p2p had an error ${msg}`);
    });

    // Establish Found Block Functionality
    _this.peer.on('blockFound', (hash) => {
      _this.processBlockNotify(hash, 'p2p');
    });
  }

  // Start Pool Stratum Server
  function startStratumServer(callback) {
    // Establish Stratum Server
    _this.stratumServer = new Stratum.Server(options, authorizeFn);

    // Establish Started Functionality
    _this.stratumServer.on('started', () => {
      let stratumPorts = Object.keys(options.ports);
      stratumPorts = stratumPorts.filter((port) => options.ports[port].enabled === true);
      options.initStats.stratumPorts = stratumPorts;
      _this.stratumServer.broadcastMiningJobs(_this.manager.currentJob.getJobParams(options));
      callback();
    });

    // Establish Timeout Functionality
    _this.stratumServer.on('broadcastTimeout', () => {
      if (options.debug) {
        // TODO(rschifflin): Why is this not flagged for line length by the linter?
        emitLog(`No new blocks for ${options.jobRebroadcastTimeout} seconds - updating transactions & rebroadcasting work`);
      }

      // TODO(rschifflin): Why is this raw call here??
      // _this.daemon.cmd('getblocktemplate', [], () => {});

      _this.cmdProcessBlock((error, rpcData, isNewBlock) => {
        if (error || isNewBlock) return;
        _this.manager.updateCurrentJob(rpcData);
      });
    });

    // Establish New Connection Functionality
    _this.stratumServer.on('client.connected', (client) => {
      // Manage/Record Client Difficulty
      if (typeof (_this.difficulty[client.socket.localPort]) !== 'undefined') {
        _this.difficulty[client.socket.localPort].manageClient(client);
      }

      // Establish Client Difficulty Functionality
      client.on('difficultyChanged', (diff) => {
        _this.emit('difficultyUpdate', client.workerName, diff);
      });

      // Establish Client Subscription Functionality
      client.on('subscription', function (params, resultCallback) {
        const extraNonce = _this.manager.extraNonceCounter.next();
        const { extraNonce2Size } = _this.manager;
        resultCallback(null, extraNonce, extraNonce2Size);
        if (typeof (options.ports[client.socket.localPort]) !== 'undefined'
          && options.ports[client.socket.localPort].diff) {
          this.sendDifficulty(options.ports[client.socket.localPort].diff);
        } else {
          this.sendDifficulty(8);
        }
        this.sendMiningJob(_this.manager.currentJob.getJobParams(options));
      });

      // Establish Client Submission Functionality
      client.on('submit', (params, resultCallback) => {
        const result = _this.manager.processShare(
          params.jobId,
          client.previousDifficulty,
          client.difficulty,
          client.extraNonce1,
          params.extraNonce2,
          params.nTime,
          params.nonce,
          params.versionRollingBits,
          client.remoteAddress,
          client.socket.localPort,
          params.name,
        );
        resultCallback(result.error, result.result ? true : null);
      });

      // Establish Client Error Messaging Functionality
      client.on('malformedMessage', () => {});

      // Establish Client Socket Error Functionality
      client.on('socketError', (e) => {
        emitWarningLog(`Socket error from ${client.getLabel()}: ${JSON.stringify(e)}`);
      });

      // Establish Client Socket Timeout Functionality
      client.on('socketTimeout', (reason) => {
        emitWarningLog(`Connected timed out for ${client.getLabel()}: ${reason}`);
      });

      // Establish Client Disconnect Functionality
      client.on('socketDisconnect', () => {});

      // Establish Client Banned Functionality
      client.on('kickedBannedIP', (remainingBanTime) => {
        // TODO(rschifflin): Why is this not flagged for line length by the linter?
        emitLog(`Rejected incoming connection from ${client.remoteAddress} banned for ${remainingBanTime} more seconds`);
      });

      // Establish Client Forgiveness Functionality
      client.on('forgaveBannedIP', () => {
        emitLog(`Forgave banned IP ${client.remoteAddress}`);
      });

      // Establish Client Unknown Stratum Functionality
      client.on('unknownStratumMethod', (fullMessage) => {
        emitLog(`Unknown stratum method from ${client.getLabel()}: ${fullMessage.method}`);
      });

      // Establish Client DDOS Functionality
      client.on('socketFlooded', () => {
        emitWarningLog(`Detected socket flooding from ${client.getLabel()}`);
      });

      // Establish Client TCP Error Functionality
      client.on('tcpProxyError', (data) => {
        // TODO(rschifflin): Why is this not flagged for line length by the linter?
        emitErrorLog(`Client IP detection failed, tcpProxyProtocol is enabled yet did not receive proxy protocol message, instead got data: ${data}`);
      });

      // Establish Client Banning Functionality
      client.on('triggerBan', (reason) => {
        emitWarningLog(`Banned triggered for ${client.getLabel()}: ${reason}`);
        _this.emit('banIP', client.remoteAddress, client.workerName);
      });
    });
  }

  // Output Derived Pool Information
  function outputPoolInfo() {
    const startMessage = `Stratum Pool Server Started for ${options.coin.name
    } [${options.coin.symbol.toUpperCase()}] {${options.coin.algorithm}}`;
    if (process.env.forkId && process.env.forkId !== '0') {
      emitLog(startMessage);
      return;
    }
    const infoLines = [startMessage,
      `Network Connected:\t${options.testnet ? 'Testnet' : 'Mainnet'}`,
      `Current Block Height:\t${_this.manager.currentJob.rpcData.height}`,
      `Current Connect Peers:\t${options.initStats.connections}`,
      // TODO(rschifflin): Why is this not flagged for line length by the linter?
      `Current Block Diff:\t${_this.manager.currentJob.difficulty * algorithms[options.coin.algorithm].multiplier}`,
      `Network Difficulty:\t${options.initStats.difficulty}`,
      `Stratum Port(s):\t${options.initStats.stratumPorts.join(', ')}`,
      `Pool Fee Percent:\t${options.feePercent}%`,
    ];
    if (typeof options.blockRefreshInterval === 'number'
      && options.blockRefreshInterval > 0) {
      infoLines.push(`Block Polling Every:\t${options.blockRefreshInterval} ms`);
    }
    emitSpecialLog(infoLines.join('\n\t\t\t\t\t\t'));
  }

  // Initialize Pool Server
  this.start = function () {
    setupDifficulty();
    setupDaemonInterface(() => {
      setupPoolData(() => {
        setupRecipients();
        setupJobManager();
        syncBlockchain(() => {
          setupFirstJob(() => {
            setupBlockPolling();
            setupPeer();
            startStratumServer(() => {
              outputPoolInfo();
              _this.emit('started');
            });
          });
        });
      });
    });
  };
};

module.exports = Pool;
Object.setPrototypeOf(Pool.prototype, events.EventEmitter.prototype);
