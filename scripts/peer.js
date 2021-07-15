/*
 *
 * Peer (Updated)
 *
 */

// Import Required Modules
const net = require('net');
const crypto = require('crypto');
const events = require('events');
const util = require('./util');

// Generate String Buffer from Parameter Length
const fixedLenStringBuffer = function (s, len) {
  const buff = Buffer.alloc(len);
  buff.fill(0);
  buff.write(s);
  return buff;
};

// Generate Command String Buffer
const commandStringBuffer = function (s) {
  return fixedLenStringBuffer(s, 12);
};

/* Reads a set amount of bytes from a flowing stream, argument descriptions:
   - stream to read from, must have data emitter
   - amount of bytes to read
   - preRead argument can be used to set start with an existing data buffer
   - callback returns 1) data buffer and 2) lopped/over-read data */

// Read Bytes Functionality
const readFlowingBytes = function (stream, amount, preRead, callback) {
  let buff = preRead || Buffer.from([]);
  const readData = function (data) {
    buff = Buffer.concat([buff, data]);
    if (buff.length >= amount) {
      const returnData = buff.slice(0, amount);
      const lopped = buff.length > amount ? buff.slice(amount) : null;
      callback(returnData, lopped);
    } else stream.once('data', readData);
  };
  readData(Buffer.from([]));
};

// Peer Main Function
const Peer = function (options) {
  // Establish Peer Variables
  const _this = this;
  let client;
  const magic = Buffer.from(options.testnet ? options.coin.peerMagicTestnet : options.coin.peerMagic, 'hex');
  const magicInt = magic.readUInt32LE(0);
  let verack = false;
  let validConnectionConfig = true;

  // Bitcoin Inventory Codes
  const invCodes = {
    error: 0,
    tx: 1,
    block: 2,
  };

  // Establish Network Variables
  const networkServices = Buffer.from('0100000000000000', 'hex'); // NODE_NETWORK services (value 1 packed as uint64)
  const emptyNetAddress = Buffer.from('010000000000000000000000000000000000ffff000000000000', 'hex');
  const userAgent = util.varStringBuffer('/node-stratum/');
  const blockStartHeight = Buffer.from('00000000', 'hex'); // block start_height, can be empty
  const relayTransactions = options.p2p.disableTransactions === true ? Buffer.from([false])
    : Buffer.from([]);

  // Establish Peer Commands
  const commands = {
    version: commandStringBuffer('version'),
    inv: commandStringBuffer('inv'),
    verack: commandStringBuffer('verack'),
    addr: commandStringBuffer('addr'),
    getblocks: commandStringBuffer('getblocks'),
  };

  // Broadcast/Send Peer Messages
  function sendMessage(command, payload) {
    const message = Buffer.concat([
      magic,
      command,
      util.packUInt32LE(payload.length),
      util.sha256d(payload).slice(0, 4),
      payload,
    ]);
    client.write(message);
    _this.emit('sentMessage', message);
  }

  // Broadcast/Send Peer Version
  function sendVersion() {
    const payload = Buffer.concat([
      util.packUInt32LE(options.protocolVersion),
      networkServices,
      util.packInt64LE(Math.trunc(Date.now() / 1000)),
      emptyNetAddress,
      emptyNetAddress,
      crypto.pseudoRandomBytes(8),
      userAgent,
      blockStartHeight,
      relayTransactions,
    ]);
    sendMessage(commands.version, payload);
  }

  // Handle Peer Inventory
  function handleInventory(payload) {
    let count = payload.readUInt8(0);
    let payloadCursor = payload.slice(1);
    if (count >= 0xfd) {
      count = payloadCursor.readUInt16LE(0);
      payloadCursor = payloadCursor.slice(2);
    }
    while (count) {
      count -= 1;
      switch (payloadCursor.readUInt32LE(0)) {
        case invCodes.tx:
          // TODO(rschifflin): Investigate dead code here; why is `tx` being parsed and thrown away?
          // var tx = payloadCursor.slice(4, 36).toString('hex');
          break;
        case invCodes.block: {
          const block = payloadCursor.slice(4, 36).toString('hex');
          _this.emit('blockFound', block);
          break;
        }
        default: // invCodes.error plus all unrecognized values:
          break;
      }
      payloadCursor = payloadCursor.slice(36);
    }
  }

  // Handle Peer Messages
  function handleMessage(command, payload) {
    _this.emit('peerMessage', { command, payload });
    switch (command) {
      case commands.inv.toString():
        handleInventory(payload);
        break;
      case commands.verack.toString():
        if (!verack) {
          verack = true;
          _this.emit('connected');
        }
        break;
      case commands.version.toString():
        sendMessage(commands.verack, Buffer.alloc(0));
        break;
      default:
        break;
    }
  }

  // Establish Peer Message Parser
  function setupMessageParser() {
    const beginReadingMessage = function (preRead) {
      readFlowingBytes(client, 24, preRead, (header, afterHeader) => {
        const msgMagic = header.readUInt32LE(0);
        if (msgMagic !== magicInt) {
          let headerCursor = header;
          _this.emit('error', 'bad magic number from peer');
          while (headerCursor.readUInt32LE(0) !== magicInt && headerCursor.length >= 4) {
            headerCursor = headerCursor.slice(1);
          }
          if (headerCursor.readUInt32LE(0) === magicInt) {
            // TODO(rschifflin):
            //    This logic seems wrong. The argument being passed should be
            //    `Buffer.concat([headerCursor, afterHeader])`. Since we found the real start of
            //    the header, then some of the valid header lies in the contiguous 'after' bits
            //    that we're currently discarding.
            beginReadingMessage(headerCursor);
          } else {
            // TODO(rschifflin):
            //    This logic seems wrong. The argument being passed should be
            //    `afterHeader`. Since we exhausted the header bits without finding the start of
            //    the header, the true start might lie in the 'after' bits that we're currently
            //    discarding.
            beginReadingMessage(Buffer.from([]));
          }
          return;
        }
        const msgCommand = header.slice(4, 16).toString();
        const msgLength = header.readUInt32LE(16);
        const msgChecksum = header.readUInt32LE(20);
        // TODO(rschifflin): Seems dangerous to allow untrusted data to determine an
        //                   arbitrary read length. `msgLength` should probably clamp
        //                   at a maximum payload size.
        readFlowingBytes(client, msgLength, afterHeader, (payload, afterPayload) => {
          if (util.sha256d(payload).readUInt32LE(0) !== msgChecksum) {
            _this.emit('error', 'bad payload - failed checksum');
            // TODO(rschifflin):
            //    This logic seems wrong. The argument being passed should be
            //    `Buffer.concat([header.slice(4), payload, afterPayload])`. If the checksum
            //    fails, the entire header+payload is garbage, and the next message could be
            //    anywhere in the bytes past the misinterpreted magic int32. Currently we discard
            //    all bytes, which means we could be missing the true start of the next valid
            //    message.
            beginReadingMessage(null);
            return;
          }
          handleMessage(msgCommand, payload);
          beginReadingMessage(afterPayload);
        });
      });
    };
    beginReadingMessage(null);
  }

  // Establish Peer Connection
  function connectPeer() {
    client = net.connect({
      host: options.p2p.host,
      port: options.p2p.port,
    }, () => {
      sendVersion();
    });

    // Manage Peer Close Functionality
    client.on('close', () => {
      if (verack) {
        _this.emit('disconnected');
        verack = false;
        connectPeer();
      } else if (validConnectionConfig) _this.emit('connectionRejected');
    });

    // Manage Peer Error Functionality
    client.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        validConnectionConfig = false;
        _this.emit('connectionFailed');
      } else _this.emit('socketError', e);
    });

    // Allow Peer to Receive/Send Messages
    setupMessageParser();
  }

  // Initialize Peer Connection
  function initializePeer() {
    connectPeer();
  }

  // Initialize Peer Connection
  initializePeer();
};

// Export Peer
module.exports = Peer;
Object.setPrototypeOf(Peer.prototype, events.EventEmitter.prototype);
