import { Client, GuildEmoji, MessageEmbed, TextChannel } from "discord.js";
import { Logger } from "winston";
import { version } from "../../package.json";
import { DynamoDBCookieStore } from "../cookies/dynamodb-cookie-store";
import { Item } from "../models/api/item";
import { Product } from "../models/api/product";
import { Notifier } from "../models/notifier";
import { StoreConfiguration } from "../models/stores/config-model";
import { Store } from "../models/stores/store";
import { ProductHelper } from "../utils/product-helper";
import { noop } from "../utils/utils";

export class DiscordNotifier implements Notifier {
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
    private readonly announceCookies: boolean = true;
    private readonly shoppingCartAlerts: boolean = true;
    private readonly store: Store;
    private readonly logger: Logger;
    private readonly productHelper = new ProductHelper();
    private readonly cookieStore: DynamoDBCookieStore | undefined;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger, cookieStore: DynamoDBCookieStore | undefined) {
        this.store = store;
        this.setupDiscordBot(storeConfig);
        setTimeout(() => (this.discordBotReady = true), 10000);

        this.announceCookies = storeConfig.announce_cookies ?? true;
        this.shoppingCartAlerts = storeConfig.shopping_cart_alerts ?? true;

        this.logger = logger;
        this.cookieStore = cookieStore;
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
        message.setURL(`${this.productHelper.getProductURL(item, this.store)}`);
        message.setFooter(`Stockshock v${version} • If you have paid for this, you have been scammed`);

        const cookiesAmount = this.cookieStore ? await this.cookieStore.getCookiesAmount(item.product) : 0;
        message.addFields([
            { name: "Magician", value: `${this.productHelper.getProductURL(item, this.store)}?magician=${item?.product?.id}` },
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
                }! Go check it out: ${this.productHelper.getProductURL(item, this.store)}?magician=${item?.product?.id}`,
                this.getRolePingsForTitle(item.product.title)
            );
        } else if (this.productHelper.canProductBeAddedToBasket(item)) {
            if (!this.shoppingCartAlerts) {
                return;
            }
            message.setDescription("🛒 Item **can be added to basket**");
            message.setColor("#60696f");
            emoji = "🛒";

            plainMessage = this.decorateMessageWithRoles(
                `🛒 Item **can be added to basket**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.productHelper.getProductURL(item, this.store)}?magician=${item?.product?.id}`,
                this.getRolePingsForTitle(item.product.title)
            );
        } else {
            message.setDescription("🟡 Item for **basket parker**");
            message.setColor("#fcca62");
            emoji = "🟡";

            plainMessage = this.decorateMessageWithRoles(
                `🟡 Item for **basket parker**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.productHelper.getProductURL(item, this.store)}`,
                this.getRolePingsForTitle(item.product.title)
            );
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

    shutdown(): void {
        return noop();
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

        this.discordBot.on("rateLimit", (error) => this.logger.error("Discord API error (rateLimit), %O", error));
        this.discordBot.on("error", (error) => this.logger.error("Discord API error (error), %O", error));
        this.discordBot.on("shardError", (error) => this.logger.error("Discord API error (shardError), %O", error));
    }

    private getRolePingsForTitle(title: string) {
        if (this.stockRegexRolePing?.size) {
            let threshold = 1;
            const rolePings: string[] = [];
            for (const [regexp, ids] of this.stockRegexRolePing.entries()) {
                if (regexp.test(title)) {
                    for (const id of ids) {
                        // In case we have the wildcard role active, increase the threshold for the fallback
                        if (regexp.toString() === "/.*/i") {
                            threshold++;
                        }
                        rolePings.push(id);
                    }
                }
            }
            if (rolePings?.length < threshold) {
                return [...rolePings, ...(this.stockRolePing?.split(",") ?? [])];
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
