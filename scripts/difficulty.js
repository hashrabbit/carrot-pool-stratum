/*
 *
 * Difficulty (Updated)
 *
 */

// Import Required Modules
const events = require('events');

// Truncate Integer to Fixed Decimal Places
function toFixed(num, len) {
  return parseFloat(num.toFixed(len));
}

// RingBuffer Main Function
function RingBuffer(maxSize) {
  // Establish Manager Variables
  let data = [];
  let cursor = 0;
  let isFull = false;

  // Append to Ring Buffer
  this.append = function (x) {
    if (isFull) {
      data[cursor] = x;
      cursor = (cursor + 1) % maxSize;
    } else {
      data.push(x);
      cursor += 1;
      if (data.length === maxSize) {
        cursor = 0;
        isFull = true;
      }
    }
  };

  // Average Ring Buffer
  this.avg = function () {
    const sum = data.reduce((a, b) => a + b);
    return sum / (isFull ? maxSize : cursor);
  };

  // Size of Ring Buffer
  this.size = function () {
    return isFull ? maxSize : cursor;
  };

  // Clear Ring Buffer
  this.clear = function () {
    data = [];
    cursor = 0;
    isFull = false;
  };
}

// Difficulty Main Function
const Difficulty = function (port, difficultyOptions) {
  // Establish Difficulty Variables
  const _this = this;
  const variance = difficultyOptions.targetTime * (difficultyOptions.variancePercent / 100);
  const bufferSize = difficultyOptions.retargetTime / (difficultyOptions.targetTime * 4);
  const tMin = difficultyOptions.targetTime - variance;
  const tMax = difficultyOptions.targetTime + variance;

  // Manage Individual Clients
  this.manageClient = function (client) {
    // Check if Client is Connected to VarDiff Port
    const stratumPort = client.socket.localPort;
    if (stratumPort !== port) {
      console.error('Handling a client which is not of this vardiff?');
    }

    // Establish Client Variables
    const options = difficultyOptions;
    let lastTs;
    let lastRtc;
    let timeBuffer;

    // Manage Client Submission
    client.on('submit', () => {
      const ts = (Date.now() / 1000) | 0;
      if (!lastRtc) {
        lastRtc = ts - options.retargetTime / 2;
        lastTs = ts;
        timeBuffer = new RingBuffer(bufferSize);
        return;
      }
      const sinceLast = ts - lastTs;
      timeBuffer.append(sinceLast);
      lastTs = ts;
      if ((ts - lastRtc) < options.retargetTime && timeBuffer.size() > 0) {
        return;
      }
      lastRtc = ts;
      const avg = timeBuffer.avg();
      let ddiff = options.targetTime / avg;
      if (avg > tMax && client.difficulty > options.minDiff) {
        if (options.x2mode) {
          ddiff = 0.5;
        }
        if (ddiff * client.difficulty < options.minDiff) {
          ddiff = options.minDiff / client.difficulty;
        }
      } else if (avg < tMin) {
        if (options.x2mode) {
          ddiff = 2;
        }
        const diffMax = options.maxDiff;
        if (ddiff * client.difficulty > diffMax) {
          ddiff = diffMax / client.difficulty;
        }
      } else {
        return;
      }
      const newDiff = toFixed(client.difficulty * ddiff, 8);
      timeBuffer.clear();
      _this.emit('newDifficulty', client, newDiff);
    });
  };
};

// Export Difficulty
module.exports = Difficulty;
Object.setPrototypeOf(Difficulty.prototype, events.EventEmitter.prototype);
