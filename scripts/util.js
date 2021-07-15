// Import Required Modules
const crypto = require('crypto');
const base58 = require('base58-native');
const bignum = require('bignum');
const bitcoin = require('bitcoinjs-lib');

// Hash Address from exAddress + Key
exports.addressFromEx = function (exAddress, ripdm160Key) {
  try {
    const versionByte = exports.getVersionByte(exAddress);
    const addrBase = Buffer.concat([versionByte, Buffer.from(ripdm160Key, 'hex')]);
    const checksum = exports.sha256d(addrBase).slice(0, 4);
    const address = Buffer.concat([addrBase, checksum]);
    return base58.encode(address);
  } catch (e) {
    return null;
  }
};

// Convert Address to Script
exports.addressToScript = function (network, addr) {
  if (typeof network !== 'undefined' && network !== null) {
    return bitcoin.address.toOutputScript(addr, network);
  }

  return Buffer.concat(
    [
      Buffer.from([0x76, 0xa9, 0x14]),
      bitcoin.address.fromBase58Check(addr).hash,
      Buffer.from([0x88, 0xac])
    ]
  );
};

// Convert Bits into Target Bignum
exports.bignumFromBitsBuffer = function (bitsBuff) {
  const numBytes = bitsBuff.readUInt8(0);
  const bigBits = bignum.fromBuffer(bitsBuff.slice(1));
  const target = bigBits.mul(
    bignum(2).pow(
      bignum(8).mul(
        numBytes - 3,
      ),
    ),
  );
  return target;
};

// Convert Bits into Target Bignum
exports.bignumFromBitsHex = function (bitsString) {
  const bitsBuff = Buffer.from(bitsString, 'hex');
  return exports.bignumFromBitsBuffer(bitsBuff);
};

// Convert Buffer to Compact Bits
exports.bufferToCompactBits = function (startingBuff) {
  const bigNum = bignum.fromBuffer(startingBuff);
  let buff = bigNum.toBuffer();
  buff = buff.readUInt8(0) > 0x7f ? Buffer.concat([Buffer.from([0x00]), buff]) : buff;
  buff = Buffer.concat([Buffer.from([buff.length]), buff]);
  const compact = buff.slice(0, 4);
  return compact;
};

// Convert Bits to Buffer
exports.convertBitsToBuff = function (bitsBuff) {
  const target = exports.bignumFromBitsBuffer(bitsBuff);
  const resultBuff = target.toBuffer();
  const buff256 = Buffer.alloc(32);
  buff256.fill(0);
  resultBuff.copy(buff256, buff256.length - resultBuff.length);
  return buff256;
};

// Get Truncated Difficulty
exports.getTruncatedDiff = function (shift) {
  return exports.convertBitsToBuff(exports.bufferToCompactBits(exports.shiftMax256Right(shift)));
};

// Get Address Version Byte
exports.getVersionByte = function (addr) {
  const versionByte = base58.decode(addr).slice(0, 1);
  return versionByte;
};

// Generate Hex String from Input Buffer
exports.hexFromReversedBuffer = function (buffer) {
  return exports.reverseBuffer(buffer).toString('hex');
};

// Convert Mining Key to Script
exports.miningKeyToScript = function (key) {
  const keyBuffer = Buffer.from(key, 'hex');
  return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), keyBuffer, Buffer.from([0x88, 0xac])]);
};

// Alloc/Write UInt16LE
exports.packUInt16LE = function (num) {
  const buff = Buffer.alloc(2);
  buff.writeUInt16LE(num, 0);
  return buff;
};

// Alloc/Write UInt32LE
exports.packUInt32LE = function (num) {
  const buff = Buffer.alloc(4);
  buff.writeUInt32LE(num, 0);
  return buff;
};

// Alloc/Write UInt32BE
exports.packUInt32BE = function (num) {
  const buff = Buffer.alloc(4);
  buff.writeUInt32BE(num, 0);
  return buff;
};

// Alloc/Write Int32LE
exports.packInt32LE = function (num) {
  const buff = Buffer.alloc(4);
  buff.writeInt32LE(num, 0);
  return buff;
};

// Alloc/Write Int32BE
exports.packInt32BE = function (num) {
  const buff = Buffer.alloc(4);
  buff.writeInt32BE(num, 0);
  return buff;
};

// Alloc/Write Int64LE
exports.packInt64LE = function (num) {
  const buff = Buffer.alloc(8);
  buff.writeUInt32LE(num % (2 ** 32), 0);
  buff.writeUInt32LE(Math.floor(num / 2 ** 32), 4);
  return buff;
};

// Convert Pubkey to Script
exports.pubkeyToScript = function (key) {
  if (key.length !== 66) {
    console.error(`Invalid pubkey: ${key}`);
    throw new Error();
  }
  const pubkey = Buffer.alloc(35);
  pubkey[0] = 0x21;
  pubkey[34] = 0xac;
  Buffer.from(key, 'hex').copy(pubkey, 1);
  return pubkey;
};

// Range Function
exports.range = function (start, stop, step) {
  if (typeof stop === 'undefined') {
    stop = start;
    start = 0;
  }
  if (typeof step === 'undefined') {
    step = 1;
  }
  if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) {
    return [];
  }
  const result = [];
  for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
    result.push(i);
  }
  return result;
};

// Reverse Input Buffer
exports.reverseBuffer = function (buff) {
  const reversed = Buffer.alloc(buff.length);
  for (let i = buff.length - 1; i >= 0; i -= 1) reversed[buff.length - i - 1] = buff[i];
  return reversed;
};

// Reverse Byte Order of Input Buffer
exports.reverseByteOrder = function (buff) {
  for (let i = 0; i < 8; i += 1) buff.writeUInt32LE(buff.readUInt32BE(i * 4), i * 4);
  return exports.reverseBuffer(buff);
};

// Reverse Input Buffer + Hex String
exports.reverseHex = function (hex) {
  return exports.reverseBuffer(Buffer.from(hex, 'hex')).toString('hex');
};

// Serialize Height/Date Input
exports.serializeNumber = function (n) {
  if (n >= 1 && n <= 16) return Buffer.from([0x50 + n]);
  let l = 1;
  const buff = Buffer.alloc(9);
  while (n > 0x7f) {
    buff.writeUInt8(n & 0xff, l += 1);
    n >>= 8;
  }
  buff.writeUInt8(l, 0);
  buff.writeUInt8(n, l += 1);
  return buff.slice(0, l);
};

// Serialize Strings used for Signature
exports.serializeString = function (s) {
  if (s.length < 253) {
    return Buffer.concat([
      Buffer.from([s.length]),
      Buffer.from(s),
    ]);
  }
  if (s.length < 0x10000) {
    return Buffer.concat([
      Buffer.from([253]),
      exports.packUInt16LE(s.length),
      Buffer.from(s),
    ]);
  }
  if (s.length < 0x100000000) {
    return Buffer.concat([
      Buffer.from([254]),
      exports.packUInt32LE(s.length),
      Buffer.from(s),
    ]);
  }
  return Buffer.concat([
    Buffer.from([255]),
    exports.packUInt16LE(s.length),
    Buffer.from(s),
  ]);
};

// Hash Input w/ Sha256
exports.sha256 = function (buffer) {
  const hash1 = crypto.createHash('sha256');
  hash1.update(buffer);
  return hash1.digest();
};

// Hash Input w/ Sha256d
exports.sha256d = function (buffer) {
  return exports.sha256(exports.sha256(buffer));
};

// Bitwise Right-Shift Max UInt256
exports.shiftMax256Right = function (shiftRight) {
  let arr256 = Array(...new Array(256)).map(Number.prototype.valueOf, 1);
  const arrLeft = Array(...new Array(shiftRight)).map(Number.prototype.valueOf, 0);
  arr256 = arrLeft.concat(arr256).slice(0, 256);
  const octets = [];
  for (let i = 0; i < 32; i += 1) {
    octets[i] = 0;
    const bits = arr256.slice(i * 8, i * 8 + 8);
    for (let f = 0; f < bits.length; f += 1) {
      const multiplier = 2 ** f;
      octets[i] += bits[f] * multiplier;
    }
  }
  return Buffer.from(octets);
};

// Generate Reverse Buffer from Input Hash
exports.uint256BufferFromHash = function (hex) {
  let fromHex = Buffer.from(hex, 'hex');
  if (fromHex.length !== 32) {
    const empty = Buffer.alloc(32);
    empty.fill(0);
    fromHex.copy(empty);
    fromHex = empty;
  }
  return exports.reverseBuffer(fromHex);
};

// Generate VarInt Buffer
exports.varIntBuffer = function (n) {
  let buff;
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    buff = Buffer.alloc(3);
    buff[0] = 0xfd;
    buff.writeUInt16LE(n, 1);
    return buff;
  }
  if (n <= 0xffffffff) {
    buff = Buffer.alloc(5);
    buff[0] = 0xfe;
    buff.writeUInt32LE(n, 1);
    return buff;
  }

  buff = Buffer.alloc(9);
  buff[0] = 0xff;
  exports.packUInt16LE(n).copy(buff, 1);
  return buff;
};

// Generate VarString Buffer
exports.varStringBuffer = function (string) {
  const strBuff = Buffer.from(string);
  return Buffer.concat([exports.varIntBuffer(strBuff.length), strBuff]);
};
