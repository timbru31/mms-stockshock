import { Client, GuildEmoji, MessageEmbed, TextChannel } from "discord.js";
import { readFileSync } from "fs";
import http from "http";
import https from "https";
import { Logger } from "winston";
import WebSocket from "ws";
import { version } from "../package.json";
import { DynamoDBCookieStore } from "./dynamodb-cookie-store";
import { Item } from "./models/api/item";
import { Product } from "./models/api/product";
import { StoreConfiguration } from "./models/stores/config-model";
import { Store } from "./models/stores/store";
import { ProductHelper } from "./product-helper";

export class Notifier {
    discordBotReady = false;
    private discordBot: Client | undefined;
    private stockChannel: TextChannel | undefined;
    private stockRegexChannel = new Map<RegExp, TextChannel>();
    private stockRolePing: string | undefined;
    private stockRegexRolePing = new Map<RegExp, string[]>();
    private cookieChannel: TextChannel | undefined;
    private cookieRolePing: string | undefined;
    private adminChannel: TextChannel | undefined;
    private adminRolePing: string | undefined;
    private noCookieEmoji: GuildEmoji | undefined | null;
    private heartBeatPing: NodeJS.Timeout | undefined;
    private readonly announceCookies: boolean = true;
    private readonly shoppingCartAlerts: boolean = true;
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
        this.shoppingCartAlerts = storeConfig.shopping_cart_alerts ?? true;

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
            if (!storeConfig.websocket_passwords?.includes(request.headers["sec-websocket-protocol"])) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                this.logger.info(`😵‍💫 WebSocket connection from client from ${socket?.remoteAddress} was denied!`);
                return;
            }
            this.logger.info(`👌 WebSocket client from ${socket?.remoteAddress} connected successfully`);
            wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
        });

        server.listen(storeConfig.websocket_port ?? 8080);

        this.heartBeatPing = setInterval(async () => {
            for (const client of wss?.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.ping();
                    this.logger.info("💖 Sending heartbeat ping to client");
                }
            }
        }, 30000);
        return wss;
    }

    closeWebSocketServer(): void {
        if (this.heartBeatPing) {
            clearInterval(this.heartBeatPing);
        }
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
            if (storeConfig?.stock_discord_regex_channel) {
                storeConfig?.stock_discord_regex_channel.map((pair) => {
                    const regexpStr = pair[0];
                    const channelId = pair[1];
                    const tempChannel = this.discordBot?.channels.cache.get(channelId);
                    if (((channel): channel is TextChannel => channel?.type === "text")(tempChannel)) {
                        const regexp = new RegExp(regexpStr, "i");
                        this.stockRegexChannel.set(regexp, tempChannel);
                    }
                });
            }

            if (storeConfig?.stock_discord_role_ping || storeConfig?.discord_role_ping) {
                this.stockRolePing = storeConfig?.stock_discord_role_ping || storeConfig?.discord_role_ping;
            }
            if (storeConfig?.stock_discord_regex_role_ping) {
                storeConfig?.stock_discord_regex_role_ping.map((pair) => {
                    const regexpStr = pair[0];
                    const roleId = pair[1].split(",");
                    const regexp = new RegExp(regexpStr, "i");
                    this.stockRegexRolePing.set(regexp, roleId);
                });
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
    async notifyStock(item: Item): Promise<string | undefined> {
        let plainMessage: string;
        const fullAlert = this.productHelper.isProductBuyable(item);
        const message = new MessageEmbed().setTimestamp();
        let emoji: string;
        message.setImage(`https://assets.mmsrg.com/isr/166325/c1/-/${item.product.titleImageId}/mobile_200_200.png`);
        message.setTitle(item?.product?.title);
        message.setURL(`${this.store.baseUrl}${this.productHelper.getProductURL(item)}`);
        message.setFooter(`Stockshock v${version} • If you have paid for this, you have been scammed`);

        const cookiesAmount = this.cookieStore ? await this.cookieStore.getCookiesAmount(item.product) : 0;
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
                value: cookiesAmount ? `${cookiesAmount} 🍪` : `${this.noCookieEmoji ?? "👎"}`,
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
            emoji = "🟢";

            plainMessage = this.decorateMessageWithRoles(
                `🟢 Item **available**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}?magician=${item?.product?.id}`,
                this.getRolePingsForTitle(item.product.title)
            );
            await this.notifyWebSocketClients(item, true);
        } else if (this.productHelper.canProductBeAddedToBasket(item)) {
            if (this.shoppingCartAlerts) {
                return;
            }
            message.setDescription("🛒 Item **can be added to basket**");
            message.setColor("#60696f");
            emoji = "🛒";

            plainMessage = this.decorateMessageWithRoles(
                `🛒 Item **can be added to basket**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}?magician=${item?.product?.id}`,
                this.getRolePingsForTitle(item.product.title)
            );
        } else {
            message.setDescription("🟡 Item for **basket parker**");
            message.setColor("#fcca62");
            emoji = "🟡";

            plainMessage = this.decorateMessageWithRoles(
                `🟡 Item for **basket parker**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}`,
                this.getRolePingsForTitle(item.product.title)
            );
            await this.notifyWebSocketClients(item, false);
        }

        const stockChannelForItem = this.getChannelForTitle(item.product.title);
        if (stockChannelForItem) {
            try {
                await stockChannelForItem.send({
                    embed: message,
                    content: this.decorateMessageWithRoles(
                        `${emoji} ${item?.product?.title} [${item?.product?.id}] for ${item?.price?.price ?? "0"} ${
                            item?.price?.currency ?? "𑿠"
                        }`,
                        this.getRolePingsForTitle(item.product.title)
                    ),
                });
            } catch (e) {
                this.logger.error("Error sending message, error: %O", e);
            }
        }
        return plainMessage;
    }

    private async notifyWebSocketClients(item: Item, direct: boolean) {
        if (this.wss) {
            for (const client of this.wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(
                        JSON.stringify({
                            direct,
                            title: item.product.title,
                            id: item.product.id,
                        }),
                        async (e) => {
                            if (e) {
                                this.logger.info("😵‍💫 Error sending stock ping, %O", e);
                                await this.notifyAdmin(`😵‍💫 [${this.store.getName()}] Error sending stock ping to client`);
                            }
                        }
                    );
                }
                this.logger.info(`🏓 Sending stock ping to with ready state ${client.readyState}`);
                await this.notifyAdmin(`🏓 [${this.store.getName()}] Sending stock ping to with ready state ${client.readyState}`);
            }
        }
    }

    private getRolePingsForTitle(title: string) {
        if (this.stockRegexRolePing?.size) {
            let threshold = 1;
            const rolePings: string[] = [];
            for (const [regexp, ids] of this.stockRegexRolePing.entries()) {
                // In case we have the wildcard role active, increase the threshold for the fallback
                if (regexp.toString() === "/.*/i") {
                    threshold++;
                }
                if (regexp.test(title)) {
                    for (const id of ids) {
                        rolePings.push(id);
                    }
                }
            }
            if (rolePings?.length < threshold) {
                return this.stockRolePing?.split(",");
            }
            return rolePings;
        }
        return this.stockRolePing?.split(",");
    }

    private getChannelForTitle(title: string) {
        if (this.stockRegexChannel?.size) {
            for (const [regexp, channel] of this.stockRegexChannel.entries()) {
                if (regexp.test(title)) {
                    return channel;
                }
            }
        }
        return this.stockChannel;
    }

    private decorateMessageWithRoles(message: string, webhookRolePings: string[] | string | undefined) {
        if (!webhookRolePings) {
            return message;
        }

        if (Array.isArray(webhookRolePings) && webhookRolePings.length) {
            return `${message} ${webhookRolePings.map((webhookRolePing) => `<@&${webhookRolePing}>`).join(" ")}`;
        } else {
            return `${message} <@&${webhookRolePings}>`;
        }
    }
}
