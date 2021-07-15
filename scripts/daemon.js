/*
 *
 * Daemon (Updated)
 *
 */

// Import Required Modules
const http = require('http');
require('child_process');
const events = require('events');
const async = require('async');

/**
 * The Daemon interface interacts with the coin Daemon by using the RPC interface.
 * in order to make it work it needs, as constructor, an array of objects containing
 * - 'host'    : hostname where the coin lives
 * - 'port'    : port where the coin accepts RPC connections
 * - 'user'    : username of the coin for the RPC interface
 * - 'password': password for the RPC interface of the coin
* */

// DaemonInterface Main Function
const DaemonInterface = function (daemons, loggerArg) {
  // Establish Private Daemon Variables
  const _this = this;
  const logger = loggerArg || function (severity, message) {
    console.log(`${severity}: ${message}`);
  };

  // Index Daemons from Parameter
  function indexDaemons() {
    const daemonsArray = daemons;
    for (let i = 0; i < daemons.length; i += 1) {
      daemonsArray[i].index = i;
    }
    return daemonsArray;
  }

  // Establish Instances
  const instances = indexDaemons();

  // Configure Daemon HTTP Requests
  function performHttpRequest(instance, jsonData, callback) {
    // Establish HTTP Options
    const options = {
      hostname: (typeof (instance.host) === 'undefined' ? '127.0.0.1' : instance.host),
      port: instance.port,
      method: 'POST',
      auth: `${instance.user}:${instance.password}`,
      headers: {
        'Content-Length': jsonData.length,
      },
    };

    // Attempt to Parse JSON from Response
    const parseJson = function (res, data) {
      let dataJson;
      if ((res.statusCode === 401) || (res.statusCode === 403)) {
        logger('error', 'Unauthorized RPC access - invalid RPC username or password');
        return;
      }
      try {
        dataJson = JSON.parse(data);
      } catch (e) {
        if (data.indexOf(':-nan') !== -1) {
          const saniData = data.replace(/:-nan,/g, ':0');
          parseJson(res, saniData);
          return;
        }
        logger('error', `Could not parse RPC data from daemon instance  ${instance.index
        }\nRequest Data: ${jsonData
        }\nReponse Data: ${data}`);
      }
      if (dataJson) {
        callback(dataJson.error, dataJson, data);
      }
    };

    // Establish HTTP Request
    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        parseJson(res, data);
      });
    });

    // Configure Error Behavior
    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') callback({ type: 'offline', message: e.message }, null);
      else callback({ type: 'request error', message: e.message }, null);
    });

    // Return JSON Output
    req.end(jsonData);
  }

  // Batch RPC Commands
  function batchCmd(cmdArray, callback) {
    const requestJson = [];
    for (let i = 0; i < cmdArray.length; i += 1) {
      requestJson.push({
        method: cmdArray[i][0],
        params: cmdArray[i][1],
        id: Date.now() + Math.floor(Math.random() * 10) + i,
      });
    }
    const serializedRequest = JSON.stringify(requestJson);
    performHttpRequest(instances[0], serializedRequest, (error, result) => {
      callback(error, result);
    });
  }

  // Single RPC Command
  function cmd(method, params, callback, streamResults, returnRawData) {
    const results = [];
    async.each(instances, (instance, eachCallback) => {
      let itemFinished = function (error, result, data) {
        const returnObj = {
          error,
          response: (result || {}).result,
          instance,
          method,
          params
        };
        if (returnRawData) returnObj.data = data;
        if (streamResults) callback(returnObj);
        else results.push(returnObj);
        eachCallback();
        itemFinished = function () {};
      };
      const requestJson = JSON.stringify({
        method,
        params,
        id: Date.now() + Math.floor(Math.random() * 10),
      });
      performHttpRequest(instance, requestJson, (error, result, data) => {
        itemFinished(error, result, data);
      });
    }, () => {
      if (!streamResults) {
        callback(results);
      }
    });
  }

  // Check if All Daemons are Online
  function isOnline(callback) {
    cmd('getpeerinfo', [], (results) => {
      const allOnline = results.every(() => !results.error);
      callback(allOnline);
      if (!allOnline) {
        _this.emit('connectionFailed', results);
      }
    });
  }

  // Initialize Daemons
  function initDaemons() {
    isOnline((online) => {
      if (online) {
        _this.emit('online');
      }
    });
  }

  // Establish Public Daemon Variables
  this.init = initDaemons;
  this.isOnline = isOnline;
  this.cmd = cmd;
  this.batchCmd = batchCmd;
};

exports.Interface = DaemonInterface;
Object.setPrototypeOf(DaemonInterface.prototype, events.EventEmitter.prototype);
