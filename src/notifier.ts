import { Logger } from "winston";
import { Item } from "./models/api/item";
import { Product } from "./models/api/product";
import { StoreConfiguration } from "./models/stores/config-model";
import { Store } from "./models/stores/store";
import { ProductHelper } from "./product-helper";
import WebSocket from "ws";
import http from "http";
import https from "https";
import { readFileSync } from "fs";
import { Client, GuildEmoji, MessageEmbed, TextChannel } from "discord.js";
import { DynamoDBCookieStore } from "./dynamodb-cookie-store";

export class Notifier {
    discordBotReady = false;
    private discordBot: Client | undefined;
    private stockChannel: TextChannel | undefined;
    private stockRolePing: string | undefined;
    private cookieChannel: TextChannel | undefined;
    private cookieRolePing: string | undefined;
    private adminChannel: TextChannel | undefined;
    private adminRolePing: string | undefined;
    private noCookieEmoji: GuildEmoji | undefined | null;
    private readonly announceCookies: boolean = true;
    private readonly store: Store;
    private readonly logger: Logger;
    private readonly productHelper = new ProductHelper();
    private readonly wss: WebSocket.Server | null;
    private readonly cookieStore: DynamoDBCookieStore | undefined;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger, cookieStore: DynamoDBCookieStore | undefined) {
        this.store = store;
        if (storeConfig?.discord_bot_token) {
            this.setupDiscordBot(storeConfig);
            setTimeout(() => (this.discordBotReady = true), 10000);
        } else {
            this.discordBotReady = true;
        }

        this.announceCookies = storeConfig.announce_cookies ?? true;

        this.logger = logger;
        this.cookieStore = cookieStore;
        this.wss = this.setupWebSocketServer(storeConfig);
    }

    setupWebSocketServer(storeConfig: StoreConfiguration): WebSocket.Server | null {
        if (!storeConfig.use_websocket) {
            return null;
        }

        let server: http.Server | https.Server;
        if (storeConfig.websocket_https) {
            server = https.createServer({
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                cert: readFileSync(storeConfig.websocket_cert_path!),
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                key: readFileSync(storeConfig.websocket_key_path!),
            });
        } else {
            server = http.createServer();
        }
        const wss = new WebSocket.Server({ noServer: true });

        server.on("upgrade", (request, socket, head) => {
            if (request.headers["sec-websocket-protocol"] !== storeConfig.websocket_password) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                this.logger.info(`😵‍💫 WebSocket connection from client from ${socket?.remoteAddress} was denied!`);
                return;
            }
            this.logger.info(`👌 WebSocket client from ${socket?.remoteAddress} connected successfully`);
            wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
        });

        server.listen(storeConfig.websocket_port ?? 8080);
        return wss;
    }

    closeWebSocketServer(): void {
        this.wss?.close();
    }

    private async setupDiscordBot(storeConfig: StoreConfiguration) {
        this.discordBot = new Client();
        await this.discordBot.login(storeConfig.discord_bot_token);
        this.discordBot.once("ready", async () => {
            this.logger.info(`👌 Discord bot integration ready`);
            this.discordBotReady = true;
            this.discordBot?.user?.setStatus("online");
            this.discordBot?.user?.setActivity({ name: "eating your cookies. 🍪", type: "PLAYING" });

            if (storeConfig?.stock_discord_channel || storeConfig?.discord_channel) {
                const tempChannel = this.discordBot?.channels.cache.get(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (storeConfig?.stock_discord_channel || storeConfig?.discord_channel)!
                );
                if (((channel): channel is TextChannel => channel?.type === "text")(tempChannel)) {
                    this.stockChannel = tempChannel;
                }
            }
            if (storeConfig?.stock_discord_role_ping || storeConfig?.discord_role_ping) {
                this.stockRolePing = storeConfig?.stock_discord_role_ping || storeConfig?.discord_role_ping;
            }

            if (storeConfig?.cookie_discord_channel || storeConfig?.discord_channel) {
                const tempChannel = this.discordBot?.channels.cache.get(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (storeConfig?.cookie_discord_channel || storeConfig?.discord_channel)!
                );
                if (((channel): channel is TextChannel => channel?.type === "text")(tempChannel)) {
                    this.cookieChannel = tempChannel;
                }
            }
            if (storeConfig?.cookie_discord_role_ping || storeConfig?.discord_role_ping) {
                this.cookieRolePing = storeConfig?.cookie_discord_role_ping || storeConfig?.discord_role_ping;
            }

            if (storeConfig?.admin_discord_channel || storeConfig?.discord_channel) {
                const tempChannel = this.discordBot?.channels.cache.get(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (storeConfig?.admin_discord_channel || storeConfig?.discord_channel)!
                );
                if (((channel): channel is TextChannel => channel?.type === "text")(tempChannel)) {
                    this.adminChannel = tempChannel;
                }
            }
            if (storeConfig?.admin_discord_role_ping || storeConfig?.discord_role_ping) {
                this.adminRolePing = storeConfig?.admin_discord_role_ping || storeConfig?.discord_role_ping;
            }

            this.noCookieEmoji = this.discordBot?.emojis.cache.find((emoji) => emoji.name == "nocookie");
        });

        this.discordBot.on("rateLimit", (error) => this.logger.error("Discord API error, %O", error));
        this.discordBot.on("error", (error) => this.logger.error("Discord API error, %O", error));
        this.discordBot.on("shardError", (error) => this.logger.error("Discord API error, %O", error));
    }

    async notifyAdmin(message: string): Promise<void> {
        if (this.adminChannel) {
            const decoratedMessage = this.decorateMessageWithRoles(message, this.adminRolePing);
            try {
                await this.adminChannel.send(decoratedMessage);
            } catch (e) {
                this.logger.error("Error sending message, error: %O", e);
            }
        }
    }

    async notifyRateLimit(seconds: number): Promise<void> {
        if (this.adminChannel && seconds > 300) {
            const message = this.decorateMessageWithRoles(
                `💤 [${this.store.getName()}] Too many requests, we need to pause ${(seconds / 60).toFixed(2)} minutes... 😴`,
                this.adminRolePing
            );
            try {
                await this.adminChannel.send(message);
            } catch (e) {
                this.logger.error("Error sending message, error: %O", e);
            }
        }
    }

    async notifyCookies(product: Product, cookies: string[]): Promise<void> {
        let rawMessage = `🍪 ${cookies.length} basket cookies were made for **${product?.id}**, **${
            product?.title
        }** for ${this.store.getName()}`;
        if (this.announceCookies) {
            rawMessage += `:\n\`${cookies.map((cookie) => `${this.store.baseUrl}?cookie=${cookie}`).join("\n")}\`\n`;
        }
        const message = this.decorateMessageWithRoles(rawMessage, this.cookieRolePing);
        if (this.cookieChannel) {
            try {
                await this.cookieChannel.send(message);
            } catch (e) {
                this.logger.error("Error sending message, error: %O", e);
            }
        }
    }
    async notifyStock(item: Item): Promise<string> {
        let plainMessage: string;
        const fullAlert = this.productHelper.isProductBuyable(item);
        const message = new MessageEmbed().setTimestamp();
        message.setImage(`https://assets.mmsrg.com/isr/166325/c1/-/${item.product.titleImageId}/mobile_200_200.png`);
        message.setTitle(item?.product?.title);
        message.setURL(`${this.store.baseUrl}${this.productHelper.getProductURL(item)}`);

        const hasCookie = this.cookieStore ? await this.cookieStore.hasCookies(item.product) : false;
        message.addFields([
            { name: "Magician", value: `${this.store.baseUrl}${this.productHelper.getProductURL(item)}?magician=${item?.product?.id}` },
            { name: "ProductID", value: item.product.id },
            {
                name: "Price",
                value: `${item?.price?.price ?? "0"} ${item?.price?.currency ?? "𑿠"}`,
                inline: true,
            },
            {
                name: "Cookies?",
                value: hasCookie ? "🍪" : `${this.noCookieEmoji ?? "👎"}`,
                inline: true,
            },
            {
                name: "Store",
                value: this.store.getName(),
                inline: true,
            },
        ]);
        if (fullAlert) {
            message.setDescription("🟢 Item **available**");
            message.setColor("#7ab05e");

            plainMessage = this.decorateMessageWithRoles(
                `🟢 Item **available**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}?magician=${item?.product?.id}`,
                this.stockRolePing
            );
            if (this.wss) {
                for (const client of this.wss.clients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({
                                direct: true,
                                title: item.product.title,
                                id: item.product.id,
                            })
                        );
                    }
                }
            }
        } else if (this.productHelper.canProductBeAddedToBasket(item)) {
            message.setDescription("🛒 Item **can be added to basket**");
            message.setColor("#60696f");
            plainMessage = this.decorateMessageWithRoles(
                `🛒 Item **can be added to basket**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}?magician=${item?.product?.id}`,
                this.stockRolePing
            );
        } else {
            message.setDescription("🟡 Item for **basket parker**");
            message.setColor("#fcca62");
            plainMessage = this.decorateMessageWithRoles(
                `🟡 Item for **basket parker**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}`,
                this.stockRolePing
            );

            if (this.wss) {
                for (const client of this.wss.clients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({
                                direct: false,
                                title: item.product.title,
                                id: item.product.id,
                            })
                        );
                    }
                }
            }
        }
        if (this.stockChannel) {
            try {
                await this.stockChannel.send({
                    embed: message,
                    content: this.decorateMessageWithRoles(
                        `${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${item?.price?.currency ?? "𑿠"}`,
                        this.stockRolePing
                    ),
                });
            } catch (e) {
                this.logger.error("Error sending message, error: %O", e);
            }
        }
        return plainMessage;
    }

    private decorateMessageWithRoles(message: string, webhookRolePing: string | undefined) {
        if (!webhookRolePing) {
            return message;
        }

        return `${message} <@&${webhookRolePing}>`;
    }
}
