/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";

// Load your modules here, e.g.:
// import * as fs from "fs";
//import { client } from "websocket";
import * as WebSockeClient from "websocket";

class Alphainnotec extends utils.Adapter {
	declare private ws;
	declare private connection;
	declare private items;
	declare private poller;
	declare private status;
	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: "alphainnotec",
		});

		this.ws = new WebSockeClient.client();
		this.connection;
		this.poller;
		this.status;
		this.items = {};

		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on("objectChange", this.onObjectChange.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	private wsConnect(): void {
		this.log.debug(`Connection to Heatpump on ${this.config.ipaddress}:${this.config.port}`);
		this.ws.connect(`ws://${this.config.ipaddress}:${this.config.port}`, "Lux_WS");
	}

	async wsCheckStatus(): Promise<void> {
		if (this.connection && this.connection.connected) {
			this.setState("info.connection", { val: true, ack: true });
		} else {
			this.setState("info.connection", { val: false, ack: true });
			this.wsReconnect("Lost Connection");
		}
	}

	private wsReconnect(error: string): void {
		this.log.error("Connect failed: " + error.toString());
		this.log.info("Trying to reconnect...");
		this.wsConnect();
	}

	async wsHandleError(error: string): Promise<void> {
		this.log.error("got an error: " + error.toString());
	}

	async wsOnClose(): Promise<void> {
		this.log.error("Websocket closed");
		// nothin yes
	}

	async wsHandleConnection(connection: any): Promise<void> {
		if (connection.connected) {
			this.connection = connection;
			this.log.info("Successfully connected to heatpump");

			// handle connection events
			this.connection.on("error", this.wsHandleError.bind(this));
			this.connection.on("close", this.wsOnClose.bind(this));
			this.connection.on("message", this.wsParseMessage.bind(this));
		}
	}

	async wsPollData(): Promise<void> {
		this.log.debug("Polling Data");
		if (this.connection && this.connection.connected) {
			this.connection.send(`LOGIN;${this.config.password}`);
		}
	}

	async SetDatapoint(name: string, value: any): Promise<void> {
		let type: ioBroker.CommonType = "mixed";
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
				unit: unit,
			},
			native: {},
		});
		this.setState(`${name}`, { val: val, ack: true });
	}

	async wsParseMessage(message: any): Promise<void> {
		//this.log.debug(message.utf8Data.toString());
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
	private async onReady(): Promise<void> {
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);

		this.ws.on("connect", this.wsHandleConnection.bind(this));
		this.wsConnect();
		this.poller = setInterval(this.wsPollData.bind(this), this.config.polltime * 1000);
		this.status = setInterval(this.wsCheckStatus.bind(this), 1000);

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		//this.log.info("config option1: " + this.config.option1);
		//this.log.info("config option2: " + this.config.option2);

		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables

		await this.setObjectNotExistsAsync("testVariable", {
			type: "state",
			common: {
				name: "testVariable",
				type: "boolean",
				role: "indicator",
				read: true,
				write: true,
			},
			native: {},
		});
		*/

		// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
		//this.subscribeStates("testVariable");
		// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
		// this.subscribeStates("lights.*");
		// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
		// this.subscribeStates("*");

		/*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
		// the variable testVariable is set to true as command (ack=false)
		//await this.setStateAsync("testVariable", true);

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		//await this.setStateAsync("testVariable", { val: true, ack: true });

		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		//await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

		// examples for the checkPassword/checkGroup functions
		//let result = await this.checkPasswordAsync("admin", "iobroker");
		//this.log.info("check user admin pw iobroker: " + result);

		//result = await this.checkGroupAsync("admin", "admin");
		//this.log.info("check group user admin group admin: " + result);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	private onUnload(callback: () => void): void {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);
			clearInterval(this.poller);
			clearInterval(this.status);

			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  */
	// private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 */
	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Alphainnotec(options);
} else {
	// otherwise start the instance directly
	(() => new Alphainnotec())();
}
