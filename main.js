"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
const WebSocketClient = require("websocket").client;
const xml2js = require("xml2js");


class Alphainnotec extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "alphainnotec",
		});

		this.ws = new WebSocketClient();
		this.connection;
		this.statusinterval;
		this.pollinterval;
		const parseroptions = {
			explicitArray: false,
			mergeAttrs: true
		};
		this.xmlparser = new xml2js.Parser(parseroptions);

		this.on("ready", this.onReady.bind(this));
		// this.on("stateChange", this.onStateChange.bind(this));
		// this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	/**
     * This will setup the websocket connection to the Heatpump.
     */
	wsConnect() {
		// bind to events
		this.log.debug("Connection to heatpump");
		this.ws.connect(`ws://${this.config.ipaddress}:${this.config.port}`, "Lux_WS");
	}

	// Reconnect to websoccet
	wsReconnect(error) {
		this.log.error("Connect failed: " + error.toString());
		this.log.info("Trying to reconnect...");
		this.wsConnect();
	}

	/**
     * This handles errors on connection
     * @param {*} error
     */
	async wsHandleError(error) {
		this.log.error("got an error: " + error.toString());
	}

	async wsOnClose() {
		// nothing here yet
	}

	/**
     * This handles Websoccet connection
     * @param {*} connection
     */
	async wsHandleConnection(connection) {
		if (connection.connected) {
			this.connection = connection;
			this.log.info("Successfully connected to heatpump");

			// handle connection events
			this.connection.on("error", this.wsHandleError.bind(this));
			this.connection.on("close", this.wsOnClose.bind(this));
			this.connection.on("message", this.wsParseMessage.bind(this));
		}
	}

	async wsPollData() {
		if (this.connection && this.connection.connected) {
			this.connection.send(`LOGIN;${this.config.password}`);
		}
	}

	async wsParseMessage(message) {
		this.xmlparser.parseString("" + message.utf8Data, this.wsHandleMessage.bind(this));
	}

	async wsHandleMessage(error, message) {
		// check if we got navigation
		if (message.Navigation) {
			try {
				message.Navigation.item.item.forEach(this.wsGetItems.bind(this));
			} catch (err) {
				return;
			}
		} else {
			this.wsProcessResponse(message.Content.name, message.Content.item);
		}
	}

	async wsGetItems(section) {
		this.connection.send(`GET;${section.id}`);
	}

	wsGetBool(str) {
		const booldefs = {
			"ein": true,
			"on": true,
			"an": true,
			"aus": false,
			"off": false,
		};
		return booldefs[str.toLowerCase()];
	}

	async wsProcessResponse(topic, items) {
		for (const [key, value] of Object.entries(items)) {
			if (value.name) {
				let type = "mixed";
				let unit = "";
				let val = value.value;
				const name = value.name.replace(/\./g, "");
				let state = topic.trim() + "." + name.trim();
				let skip = false;

				// Blacklist check
				const lines = this.config.blacklist.split("\n");
				for (let i = 0; i < lines.length; i++) {
					const flags = lines[i].replace(/.*\/([gimy]*)$/, "$1");
					const pattern = lines[i].replace(new RegExp("^/(.*?)/" + flags + "$"), "$1");
					const regex = new RegExp(pattern, flags);
					if (state.match(regex)) {
						this.log.debug("skipping (" + state + "): " + lines[i]);
						skip = true;
					}
				}
				if (skip) { continue; }

				// check if we got a float with a unit
				if ((/^-?\s*[\d.]+\s*[^\d]+$/.test(val)) && (!/^\d+:/.test(val))) {
					const matches = val.match(/^(-?\s*[\d.]+)\s*([^\d]+)$/);
					val = parseFloat(matches[1]);
					unit = matches[2] || "";
					type = "number";
				} else if (this.wsGetBool(value.value) !== undefined) {
					val = this.wsGetBool(value.value);
					type = "boolean";
				}

				// check if exists with different type
				const check = await this.getObjectAsync(state);
				if (check && check.common.type !== type) {
					state = topic.trim() + "._" + name.trim();
				}

				await this.setObjectNotExistsAsync(state, {
					type: "state",
					common: {
						name: value.name,
						type: type,
						role: "state",
						unit: unit,
						read: true,
						write: false
					},
					native: {},
				});
				await this.setStateAsync(state, { val: val, ack: true });
			}
		}
	}

	async wsCheckStatus() {
		if (this.connection && this.connection.connected) {
			this.setState("info.connection", { val: true, ack: true });
		} else {
			this.setState("info.connection", { val: false, ack: true });
			this.wsReconnect("Lost Connection");
		}
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);

		this.ws.on("connect", this.wsHandleConnection.bind(this));
		this.ws.on("connectFailed", this.wsHandleError.bind(this));
		this.wsConnect();
		let interval = this.config.polltime;
		if (interval < 5) {
			interval = 5;
		}

		this.pollinterval = setInterval(this.wsPollData.bind(this), interval * 1000);
		this.statusinterval = setInterval(this.wsCheckStatus.bind(this), 1000);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			clearInterval(this.pollinterval);
			clearInterval(this.statusinterval);

			callback();
		} catch (e) {
			callback();
		}
	}

}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Alphainnotec(options);
} else {
	// otherwise start the instance directly
	new Alphainnotec();
}