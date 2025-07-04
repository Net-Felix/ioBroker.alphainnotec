/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";

// Load your modules here, e.g.:
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
		this.log.info(`Connection to Heatpump on ${this.config.ipaddress}:${this.config.port}`);
		this.ws.connect(`ws://${this.config.ipaddress}:${this.config.port}`, "Lux_WS");
	}

	private async wsCheckStatus(): Promise<void> {
		if (this.connection && this.connection.connected) {
			this.log.debug("Connection is OK");
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

	private async wsHandleError(error: string): Promise<void> {
		this.wsReconnect(error.toString());
	}

	private async wsOnClose(): Promise<void> {
		this.wsReconnect("Websocket closed");
	}

	private async wsHandleConnection(connection: any): Promise<void> {
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
					// Poll only Informationen
					if (json.name == "Informationen") {
						for (const item of json.items) {
							const subname = item.name.replace(/\./g, "");
							this.log.debug(`Found Section: ${topfolder}.${subname}`);
							if (Array.isArray(item.items)) {
								for (const datapoint of item.items) {
									//const dpName = `${topfolder}.${subname}.${datapoint.name.replace(/\./g, "")}`;
									const dpName = `${subname}.${datapoint.name.replace(/\./g, "")}`;
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
			}
		} catch (err) {
			return;
		}
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);

		this.ws.on("connect", this.wsHandleConnection.bind(this));
		this.wsConnect();
		this.wsPollData.bind(this);
		this.poller = setInterval(this.wsPollData.bind(this), this.config.polltime * 1000);
		this.status = setInterval(this.wsCheckStatus.bind(this), 1000);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	private onUnload(callback: () => void): void {
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
