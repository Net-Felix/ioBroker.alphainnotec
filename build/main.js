"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var WebSockeClient = __toESM(require("websocket"));
class Alphainnotec extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "alphainnotec"
    });
    this.ws = new WebSockeClient.client();
    this.connection;
    this.poller;
    this.status;
    this.items = {};
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  wsConnect() {
    this.log.info(`Connection to Heatpump on ${this.config.ipaddress}:${this.config.port}`);
    this.ws.connect(`ws://${this.config.ipaddress}:${this.config.port}`, "Lux_WS");
  }
  async wsCheckStatus() {
    if (this.connection && this.connection.connected) {
      this.log.debug("Connection is OK");
      this.setState("info.connection", { val: true, ack: true });
    } else {
      this.setState("info.connection", { val: false, ack: true });
      this.wsReconnect("Lost Connection");
    }
  }
  wsReconnect(error) {
    this.log.error("Connect failed: " + error.toString());
    this.log.info("Trying to reconnect...");
    this.wsConnect();
  }
  async wsHandleError(error) {
    this.wsReconnect(error.toString());
  }
  async wsOnClose() {
    this.wsReconnect("Websocket closed");
  }
  async wsHandleConnection(connection) {
    if (connection.connected) {
      this.connection = connection;
      this.log.info("Successfully connected to heatpump");
      this.connection.on("error", this.wsHandleError.bind(this));
      this.connection.on("close", this.wsOnClose.bind(this));
      this.connection.on("message", this.wsParseMessage.bind(this));
    }
  }
  async wsPollData() {
    this.log.debug("Polling Data");
    if (this.connection && this.connection.connected) {
      this.connection.send(`LOGIN;${this.config.password}`);
    }
  }
  async SetDatapoint(name, value) {
    let type = "mixed";
    let unit = "";
    let val;
    if (/^-?\s*[\d.-]+\s*[^\d]+$/.test(value) && !/^\d+:/.test(value)) {
      const matches = value.match(/^(-?\s*[\d.-]+)\s*([^\d]+)$/);
      val = parseFloat(matches[1]);
      unit = matches[2];
      type = "mixed";
    } else {
      val = value;
    }
    await this.setObjectNotExistsAsync(`${name}`, {
      type: "state",
      common: {
        name: `${name}`,
        type: `${type}`,
        role: "state",
        read: true,
        write: false,
        unit
      },
      native: {}
    });
    this.setState(`${name}`, { val, ack: true });
  }
  async wsParseMessage(message) {
    let json;
    try {
      json = JSON.parse(message.utf8Data.toString());
      if (json.type == "Navigation") {
        this.items = json.items;
        for (const item of json.items) {
          this.log.debug(`Polling ${item.name}`);
          this.connection.send(`GET;${item.id}`);
        }
      }
      if (json.type == "Content") {
        if (typeof json.name !== "undefined") {
          const topfolder = json.name.replace(/\./g, "");
          for (const item of json.items) {
            const subname = item.name.replace(/\./g, "");
            this.log.debug(`Found Section: ${topfolder}.${subname}`);
            if (Array.isArray(item.items)) {
              for (const datapoint of item.items) {
                const dpName = `${topfolder}.${subname}.${datapoint.name.replace(/\./g, "")}`;
                if (Array.isArray(datapoint.items)) {
                  for (const subdatapoint of datapoint.items) {
                    const subdpName = `${dpName}.${subdatapoint.name.replace(/\./g, "")}`;
                    await this.SetDatapoint(subdpName, subdatapoint.value);
                  }
                } else {
                  await this.SetDatapoint(dpName, datapoint.value);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      return;
    }
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.setState("info.connection", false, true);
    this.ws.on("connect", this.wsHandleConnection.bind(this));
    this.wsConnect();
    this.wsPollData.bind(this);
    this.poller = setInterval(this.wsPollData.bind(this), this.config.polltime * 1e3);
    this.status = setInterval(this.wsCheckStatus.bind(this), 1e3);
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   */
  onUnload(callback) {
    try {
      clearInterval(this.poller);
      clearInterval(this.status);
      callback();
    } catch (e) {
      callback();
    }
  }
  /**
   * Is called if a subscribed state changes
   */
  onStateChange(id, state) {
    if (state) {
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    } else {
      this.log.info(`state ${id} deleted`);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Alphainnotec(options);
} else {
  (() => new Alphainnotec())();
}
//# sourceMappingURL=main.js.map
