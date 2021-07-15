// Import Required Modules
const net = require('net');
const events = require('events');
const util = require('./util.js');

// Increment Count for Each Subscription
const SubscriptionCounter = function () {
  let count = 0;
  const padding = 'deadbeefcafebabe';
  return {
    next() {
      count += 1;
      if (Number.MAX_VALUE === count) count = 0;
      return padding + util.packInt64LE(count).toString('hex');
    },
  };
};

/**
 * Defining each client that connects to the stratum server.
 * Emits:
 *  - subscription(obj, cback(error, extraNonce1, extraNonce2Size))
 *  - submit(data(name, jobID, extraNonce2, ntime, nonce))
* */

// Stratum Client Main Function
const StratumClient = function (options) {
  // Establish Private Stratum Variables
  const _this = this;
  const { banning } = options;
  let pendingDifficulty = null;

  // Establish Public Stratum Variables
  this.lastActivity = Date.now();
  this.socket = options.socket;
  this.remoteAddress = options.socket.remoteAddress;
  this.shares = { valid: 0, invalid: 0 };

  // Helper Function if Banning is Disabled
  function banningDisabled() {
    return false;
  }

  // Helper Function if Banning is Enabled
  function banningEnabled(shareValid) {
    if (shareValid === true) {
      _this.shares.valid += 1;
    } else {
      _this.shares.invalid += 1;
    }
    const totalShares = _this.shares.valid + _this.shares.invalid;
    if (totalShares >= banning.checkThreshold) {
      const percentBad = (_this.shares.invalid / totalShares) * 100;
      if (percentBad < banning.invalidPercent) {
        this.shares = { valid: 0, invalid: 0 };
      } else {
        _this.emit('triggerBan', `${_this.shares.invalid} out of the last ${totalShares} shares were invalid`);
        _this.socket.destroy();
        return true;
      }
    }
    return false;
  }

  // Determine Whether to Consider Banning
  const considerBan = (!banning || !banning.enabled) ? banningDisabled : banningEnabled;

  // Manage JSON Functionality
  function sendJson(...args) {
    let response = '';
    for (let i = 0; i < args.length; i += 1) {
      response += `${JSON.stringify(args[i])}\n`;
    }
    options.socket.write(response);
  }

  // Get Label of Stratum Client
  this.getLabel = function () {
    return `${_this.workerName || '(unauthorized)'} [${_this.remoteAddress}]`;
  };

  // Push Updated Difficulty to Difficulty Queue
  this.enqueueNextDifficulty = function (requestedNewDifficulty) {
    pendingDifficulty = requestedNewDifficulty;
    return true;
  };

  // Broadcast Difficulty to Stratum Client
  this.sendDifficulty = function (difficulty) {
    if (difficulty === this.difficulty) return false;
    _this.previousDifficulty = _this.difficulty;
    _this.difficulty = difficulty;
    sendJson({
      id: null,
      method: 'mining.set_difficulty',
      params: [difficulty],
    });
    return true;
  };

  // Manage Stratum Subscription
  function handleSubscribe(message) {
    if (!_this.authorized) {
      _this.requestedSubscriptionBeforeAuth = true;
    }
    _this.emit('subscription', {}, (error, extraNonce1, extraNonce2Size) => {
      if (error) {
        sendJson({
          id: message.id,
          result: null,
          error,
        });
        return;
      }
      _this.extraNonce1 = extraNonce1;
      sendJson({
        id: message.id,
        result: [
          [
            ['mining.set_difficulty', options.subscriptionId],
            ['mining.notify', options.subscriptionId],
          ],
          extraNonce1,
          extraNonce2Size,
        ],
        error: null,
      });
    });
  }

  // Manage Stratum Authorization
  function handleAuthorize(message, replyToSocket) {
    [_this.workerName, _this.workerPass] = message.params;
    const args = [
      _this.remoteAddress, options.socket.localPort, _this.workerName, _this.workerPass];
    options.authorizeFn(...args, (result) => {
      _this.authorized = (!result.error && result.authorized);
      if (replyToSocket) {
        sendJson({
          id: message.id,
          result: _this.authorized,
          error: result.error,
        });
      }
      if (result.disconnect === true) {
        options.socket.destroy();
      }
    });
  }

  // Manage Stratum Submission
  function handleSubmit(message) {
    if (!_this.authorized) {
      sendJson({
        id: message.id,
        result: null,
        error: [24, 'unauthorized worker', null],
      });
      considerBan(false);
      return;
    }
    if (!_this.extraNonce1) {
      sendJson({
        id: message.id,
        result: null,
        error: [25, 'not subscribed', null],
      });
      considerBan(false);
      return;
    }
    _this.emit('submit',
      {
        name: message.params[0],
        jobId: message.params[1],
        extraNonce2: message.params[2],
        nTime: message.params[3].toLowerCase(),
        nonce: message.params[4].toLowerCase(),
      },
      (error, result) => {
        if (!considerBan(result)) {
          sendJson({
            id: message.id,
            result,
            error,
          });
        }
      });
  }

  // Handle Stratum Messages
  function handleMessage(message) {
    switch (message.method) {
      // Manage Stratum Subscription
      case 'mining.subscribe':
        handleSubscribe(message);
        break;

        // Manage Stratum Authorization
      case 'mining.authorize':
        handleAuthorize(message, true);
        break;

        // Manage Stratum Submission
      case 'mining.submit':
        _this.lastActivity = Date.now();
        handleSubmit(message);
        break;

        // Manage Transactions
      case 'mining.get_transactions':
        sendJson({
          id: null,
          result: [],
          error: true,
        });
        break;

        // Manage Extranonce Capabilities
      case 'mining.extranonce.subscribe':
        sendJson({
          id: message.id,
          result: false,
          error: [20, 'Not supported.', null],
        });
        break;

        // Unknown Stratum Method
      default:
        _this.emit('unknownStratumMethod', message);
        break;
    }
  }

  // Establish Stratum Connection
  function setupSocket() {
    // Setup Main Socket Connection
    let dataBuffer = '';
    const { socket } = options;
    socket.setEncoding('utf8');
    if (options.tcpProxyProtocol === true) {
      socket.once('data', (d) => {
        if (d.indexOf('PROXY') === 0) {
          [, _this.remoteAddress] = d.split(' ');
        } else {
          _this.emit('tcpProxyError', d);
        }
        _this.emit('checkBan');
      });
    } else {
      _this.emit('checkBan');
    }

    // Manage Stratum Data Functionality
    socket.on('data', (d) => {
      dataBuffer += d;
      if (Buffer.byteLength(dataBuffer, 'utf8') > 10240) {
        dataBuffer = '';
        _this.emit('socketFlooded');
        socket.destroy();
        return;
      }
      if (dataBuffer.indexOf('\n') !== -1) {
        const messages = dataBuffer.split('\n');
        const incomplete = dataBuffer.slice(-1) === '\n' ? '' : messages.pop();
        messages.forEach((message) => {
          if (message === '') return;
          let messageJson;
          try {
            messageJson = JSON.parse(message);
          } catch (e) {
            if (options.tcpProxyProtocol !== true || d.indexOf('PROXY') !== 0) {
              _this.emit('malformedMessage', message);
              socket.destroy();
            }
            return;
          }
          if (messageJson) {
            handleMessage(messageJson);
          }
        });
        dataBuffer = incomplete;
      }
    });

    // Manage Stratum Close Functionality
    socket.on('close', () => {
      _this.emit('socketDisconnect');
    });

    // Manage Stratum Error Functionality
    socket.on('error', (err) => {
      if (err.code !== 'ECONNRESET') _this.emit('socketError', err);
    });
  }

  // Initialize Stratum Connection
  function initializeClient() {
    setupSocket();
  }

  // Broadcast Mining Job to Stratum Client
  this.sendMiningJob = function (jobParams) {
    const lastActivityAgo = Date.now() - _this.lastActivity;
    if (lastActivityAgo > options.connectionTimeout * 1000) {
      _this.emit(
        'socketTimeout',
        `last submitted a share was ${(lastActivityAgo / 1000 | 0)} seconds ago`,
      );
      _this.socket.destroy();
      return;
    }
    if (pendingDifficulty !== null) {
      const result = _this.sendDifficulty(pendingDifficulty);
      pendingDifficulty = null;
      if (result) {
        _this.emit('difficultyChanged', _this.difficulty);
      }
    }
    sendJson({
      id: null,
      method: 'mining.notify',
      params: jobParams,
    });
  };

  // Manually Authorize Stratum Client
  this.manuallyAuthClient = function (username, password) {
    handleAuthorize({ id: 1, params: [username, password] }, false);
  };

  // Manually Copy Values from Stratum Client
  this.manuallySetValues = function (otherClient) {
    _this.extraNonce1 = otherClient.extraNonce1;
    _this.previousDifficulty = otherClient.previousDifficulty;
    _this.difficulty = otherClient.difficulty;
  };

  // Initialize Stratum Connection
  this.init = initializeClient;
};

/**
 * The actual stratum server.
 * It emits the following Events:
 *   - 'client.connected'(StratumClientInstance) - when a new miner connects
 *   - 'client.disconnected'(StratumClientInstance) - when a miner disconnects.
 *      Be aware that the socket cannot be used anymore.
 *   - 'started' - when the server is up and running
 * */

// Stratum Client Main Function
const StratumServer = function (options, authorizeFn) {
  // Establish Private Stratum Variables
  const _this = this;
  const stratumClients = {};
  const subscriptionCounter = SubscriptionCounter();
  let rebroadcastTimeout;
  const bannedIPs = {};

  // Determine Length of Client Ban
  const bannedMS = options.banning ? options.banning.time * 1000 : null;

  // Check Regarding Banned Clients
  function checkBan(client) {
    if (options.banning && options.banning.enabled && client.remoteAddress in bannedIPs) {
      const bannedTime = bannedIPs[client.remoteAddress];
      const bannedTimeAgo = Date.now() - bannedTime;
      const timeLeft = bannedMS - bannedTimeAgo;
      if (timeLeft > 0) {
        client.socket.destroy();
        client.emit('kickedBannedIP', timeLeft / 1000 | 0);
      } else {
        delete bannedIPs[client.remoteAddress];
        client.emit('forgaveBannedIP');
      }
    }
  }

  // Manage New Client Connections
  this.handleNewClient = function (socket) {
    // Establish New Stratum Client
    socket.setKeepAlive(true);
    const subscriptionId = subscriptionCounter.next();
    const client = new StratumClient({
      subscriptionId,
      authorizeFn,
      socket,
      banning: options.banning,
      connectionTimeout: options.connectionTimeout,
      tcpProxyProtocol: options.tcpProxyProtocol,
    });
    stratumClients[subscriptionId] = client;

    // Manage Client Behaviors
    _this.emit('client.connected', client);
    client.on('socketDisconnect', () => {
      _this.manuallyRemoveStratumClient(subscriptionId);
      _this.emit('client.disconnected', client);
    }).on('checkBan', () => {
      checkBan(client);
    }).on('triggerBan', () => {
      _this.addBannedIP(client.remoteAddress);
    }).init();

    // Return Client Subscription ID
    return subscriptionId;
  };

  // Broadcast New Jobs to Clients
  this.broadcastMiningJobs = function (jobParams) {
    Object.values(stratumClients).forEach((client) => {
      client.sendMiningJob(jobParams);
    });
    clearTimeout(rebroadcastTimeout);
    rebroadcastTimeout = setTimeout(() => {
      _this.emit('broadcastTimeout');
    }, options.jobRebroadcastTimeout * 1000);
  };

  // Add Banned IP to List of Banned IPs
  this.addBannedIP = function (ipAddress) {
    bannedIPs[ipAddress] = Date.now();
  };

  // Return Current Connected Clients
  this.getStratumClients = function () {
    return stratumClients;
  };

  // Manually Add Stratum Client to Stratum Server
  this.manuallyAddStratumClient = function (clientObj) {
    const subId = _this.handleNewClient(clientObj.socket);
    if (subId != null) { // not banned!
      stratumClients[subId].manuallyAuthClient(clientObj.workerName, clientObj.workerPass);
      stratumClients[subId].manuallySetValues(clientObj);
    }
  };

  // Manually Remove Stratum Client from Stratum Server
  this.manuallyRemoveStratumClient = function (subscriptionId) {
    delete stratumClients[subscriptionId];
  };

  // Initialize Stratum Connection
  function initializeServer() {
    // Interval to Clear Old Bans from BannedIPs
    if (options.banning && options.banning.enabled) {
      setInterval(() => {
        Object.keys(bannedIPs).forEach((ip) => {
          const banTime = bannedIPs[ip];
          if (Date.now() - banTime > options.banning.time) delete bannedIPs[ip];
        });
      }, 1000 * options.banning.purgeInterval);
    }

    // Start Individual Stratum Ports
    let serversStarted = 0;
    let stratumPorts = Object.keys(options.ports);
    stratumPorts = stratumPorts.filter((port) => options.ports[port].enabled === true);

    // Start Individual Stratum Servers
    stratumPorts.forEach((port) => {
      net.createServer({ allowHalfOpen: false }, (socket) => {
        _this.handleNewClient(socket);
      }).listen(parseInt(port, 10), () => {
        serversStarted += 1;
        if (serversStarted === stratumPorts.length) {
          _this.emit('started');
        }
      });
    });
  }

  // Initialize Stratum Connection
  initializeServer();
};

// Export Stratum Client/Server
exports.Server = StratumServer;
Object.setPrototypeOf(StratumClient.prototype, events.EventEmitter.prototype);
Object.setPrototypeOf(StratumServer.prototype, events.EventEmitter.prototype);
