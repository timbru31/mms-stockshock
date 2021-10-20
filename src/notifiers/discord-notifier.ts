import type { TextChannel } from "discord.js";
import { Client, MessageEmbed } from "discord.js";
import type { Logger } from "winston";
import { version } from "../../package.json";
import type { Item } from "../models/api/item";
import type { Product } from "../models/api/product";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import type { Store } from "../models/stores/store";
import { ProductHelper } from "../utils/product-helper";
import { noop } from "../utils/utils";

export class DiscordNotifier implements Notifier {
    discordBotReady = false;
    private discordBot: Client | undefined;
    private stockChannel: TextChannel | undefined;
    private readonly stockRegexChannel = new Map<RegExp, TextChannel>();
    private stockRolePing: string | undefined;
    private readonly stockRegexRolePing = new Map<RegExp, string[]>();
    private cookieChannel: TextChannel | undefined;
    private cookieRolePing: string | undefined;
    private adminChannel: TextChannel | undefined;
    private adminRolePing: string | undefined;
    private priceChangeChannel: TextChannel | undefined;
    private priceChangeRolePing: string | undefined;
    private noCookieEmoji: string | undefined;
    private readonly checkOnlineStatus: boolean;
    private readonly announceCookies: boolean = true;
    private readonly shoppingCartAlerts: boolean = true;
    private readonly showCookiesAmount: boolean = true;
    private readonly showMagicianLink: boolean = true;
    private readonly store: Store;
    private readonly logger: Logger;
    private readonly productHelper = new ProductHelper();
    private readonly replacements = new Map<string, string>();
    private readonly discordBotTimeout = 10000;
    private readonly zero = 0;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger) {
        this.store = store;
        void this.setupDiscordBot(storeConfig);
        setTimeout(() => (this.discordBotReady = true), this.discordBotTimeout);

        this.announceCookies = storeConfig.announce_cookies ?? true;
        this.shoppingCartAlerts = storeConfig.shopping_cart_alerts ?? true;
        this.showCookiesAmount = storeConfig.show_cookies_amount ?? true;
        this.showMagicianLink = storeConfig.show_magician_link ?? true;
        this.checkOnlineStatus = storeConfig.check_online_status ?? false;

        this.logger = logger;

        if (storeConfig.id_replacements) {
            const key = 0;
            const value = 1;
            storeConfig.id_replacements.map((pair) => {
                const id = pair[key];
                const url = pair[value];
                this.replacements.set(id, url);
            });
        }
    }

    async notifyAdmin(message?: string): Promise<void> {
        if (this.adminChannel && message) {
            const decoratedMessage = this.decorateMessageWithRoles(message, this.adminRolePing);
            try {
                await this.adminChannel.send(decoratedMessage);
            } catch (e: unknown) {
                this.logger.error("Error sending message, error: %O", e);
            }
        }
    }

    async notifyRateLimit(seconds?: number): Promise<void> {
        const fiveMinutesInSeconds = 300;
        if (this.adminChannel && seconds && seconds > fiveMinutesInSeconds) {
            const precision = 2;
            const minutesFactor = 60;
            const message = this.decorateMessageWithRoles(
                `💤 [${this.store.getName()}] Too many requests, we need to pause ${(seconds / minutesFactor).toFixed(
                    precision
                )} minutes... 😴`,
                this.adminRolePing
            );
            try {
                await this.adminChannel.send(message);
            } catch (e: unknown) {
                this.logger.error("Error sending message, error: %O", e);
            }
        }
    }

    async notifyCookies(product?: Product, cookies?: string[]): Promise<void> {
        if (product && cookies) {
            let rawMessage = `🍪 ${cookies.length} basket cookies were made for **${product.id}**, **${
                product.title
            }** for ${this.store.getName()}`;
            if (this.announceCookies) {
                rawMessage += `:\n\`${cookies.map((cookie) => `${this.store.baseUrl}?cookie=${cookie}`).join("\n")}\`\n`;
            }
            const message = this.decorateMessageWithRoles(rawMessage, this.cookieRolePing);
            if (this.cookieChannel) {
                try {
                    await this.cookieChannel.send(message);
                } catch (e: unknown) {
                    this.logger.error("Error sending message, error: %O", e);
                }
            }
        }
    }

    async notifyStock(item?: Item, cookiesAmount?: number): Promise<string | undefined> {
        if (!item?.product) {
            return;
        }
        let plainMessage: string;
        const fullAlert = this.productHelper.isProductBuyable(item, this.checkOnlineStatus);
        let emoji: string;
        const embed = this.createEmbed(item);

        const price = item.price?.price ?? "0";
        const currency = item.price?.currency ?? "𑿠";
        embed.addFields([
            { name: "ProductID", value: item.product.id },
            {
                name: "Price",
                value: `${price} ${currency}`,
                inline: true,
            },
            {
                name: "Store",
                value: this.store.getName(),
                inline: true,
            },
        ]);
        if (this.showMagicianLink) {
            embed.addField("Magician", `${this.productHelper.getProductURL(item, this.store, this.replacements, true)}`);
        }
        if (this.showCookiesAmount) {
            embed.addField("Cookies", cookiesAmount ? `${cookiesAmount} 🍪` : `${this.noCookieEmoji ?? "👎"}`, true);
        }
        if (fullAlert) {
            embed.setDescription("🟢 Item **available**");
            embed.setColor("#7ab05e");
            emoji = "🟢";

            plainMessage = this.decorateMessageWithRoles(
                `🟢 Item **available**: ${item.product.id}, ${
                    item.product.title
                } for ${price} ${currency}! Go check it out: ${this.productHelper.getProductURL(
                    item,
                    this.store,
                    this.replacements,
                    true
                )}`,
                this.getRolePingsForTitle(item.product.title)
            );
        } else if (this.productHelper.canProductBeAddedToBasket(item, this.checkOnlineStatus)) {
            if (!this.shoppingCartAlerts) {
                return;
            }
            embed.setDescription("🛒 Item **can be added to basket**");
            embed.setColor("#60696f");
            emoji = "🛒";

            plainMessage = this.decorateMessageWithRoles(
                `🛒 Item **can be added to basket**: ${item.product.id}, ${
                    item.product.title
                } for ${price} ${currency}! Go check it out: ${this.productHelper.getProductURL(
                    item,
                    this.store,
                    this.replacements,
                    true
                )}`,
                this.getRolePingsForTitle(item.product.title)
            );
        } else {
            embed.setDescription("🟡 Item for **basket parker**");
            embed.setColor("#fcca62");
            emoji = "🟡";

            plainMessage = this.decorateMessageWithRoles(
                `🟡 Item for **basket parker**: ${item.product.id}, ${
                    item.product.title
                } for ${price} ${currency}! Go check it out: ${this.productHelper.getProductURL(item, this.store, this.replacements)}`,
                this.getRolePingsForTitle(item.product.title)
            );
        }

        const stockChannelForItem = this.getChannelForTitle(item.product.title);
        if (stockChannelForItem) {
            try {
                await stockChannelForItem.send({
                    embeds: [embed],
                    content: this.decorateMessageWithRoles(
                        `${emoji} ${item.product.title} [${item.product.id}] for ${price} ${currency}`,
                        this.getRolePingsForTitle(item.product.title)
                    ),
                });
            } catch (e: unknown) {
                this.logger.error("Error sending message, error: %O", e);
            }
        }
        return plainMessage;
    }

    async notifyPriceChange(item?: Item, oldPrice?: number): Promise<void> {
        if (item?.product && oldPrice) {
            const embed = this.createEmbed(item);
            const currency = item.price?.currency ?? "𑿠";
            const newPrice = item.price?.price ?? this.zero;
            const delta = newPrice - oldPrice;
            const percentageFactor = 100;
            const precision = 2;
            const deltaPercentage = ((newPrice - oldPrice) / oldPrice) * percentageFactor;

            embed.addFields([
                { name: "ProductID", value: item.product.id },
                {
                    name: "Old Price",
                    value: `${oldPrice} ${currency}`,
                    inline: true,
                },
                {
                    name: "New Price",
                    value: `${newPrice} ${currency}`,
                    inline: true,
                },
                {
                    name: "Delta",
                    value: `${delta.toFixed(precision)} ${currency} (${deltaPercentage.toFixed(precision)}%)`,
                    inline: true,
                },
                {
                    name: "Store",
                    value: this.store.getName(),
                    inline: true,
                },
            ]);

            const emoji = delta > this.zero ? "⏫" : "⏬";
            embed.setDescription(`${emoji} Price change`);
            embed.setColor(delta > this.zero ? "#c31515" : "#7ab05e");

            if (this.priceChangeChannel) {
                try {
                    await this.priceChangeChannel.send({
                        embeds: [embed],
                        content: this.decorateMessageWithRoles(
                            `${emoji} ${item.product.title} [${
                                item.product.id
                            }] changed the price from ${oldPrice} ${currency} to ${newPrice} ${currency} (${deltaPercentage.toFixed(
                                precision
                            )}%)`,
                            this.priceChangeRolePing
                        ),
                    });
                } catch (e: unknown) {
                    this.logger.error("Error sending message, error: %O", e);
                }
            }
        }
    }

    shutdown(): void {
        noop();
    }

    private async setupDiscordBot(storeConfig: StoreConfiguration) {
        this.discordBot = new Client({
            intents: [],
        });
        await this.discordBot.login(storeConfig.discord_bot_token);
        this.discordBot.once("ready", async () => {
            this.logger.info("👌 Discord bot integration ready");
            this.discordBotReady = true;
            this.discordBot?.user?.setStatus("online");
            this.discordBot?.user?.setActivity({ name: "eating your cookies. 🍪", type: "PLAYING" });
            const key = 0;
            const value = 1;

            if (storeConfig.stock_discord_channel || storeConfig.discord_channel) {
                const tempChannel = await this.discordBot?.channels.fetch(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (storeConfig.stock_discord_channel ?? storeConfig.discord_channel)!
                );
                if (((channel): channel is TextChannel => channel?.type === "GUILD_TEXT")(tempChannel)) {
                    this.stockChannel = tempChannel;
                }
            }
            if (storeConfig.stock_discord_regex_channel) {
                storeConfig.stock_discord_regex_channel.map(async (pair) => {
                    const regexpStr = pair[key];
                    const channelId = pair[value];
                    const tempChannel = await this.discordBot?.channels.fetch(channelId);
                    if (((channel): channel is TextChannel => channel?.type === "GUILD_TEXT")(tempChannel)) {
                        const regexp = new RegExp(regexpStr, "i");
                        this.stockRegexChannel.set(regexp, tempChannel);
                    }
                });
            }

            if (storeConfig.stock_discord_role_ping || storeConfig.discord_role_ping) {
                this.stockRolePing = storeConfig.stock_discord_role_ping ?? storeConfig.discord_role_ping;
            }
            if (storeConfig.stock_discord_regex_role_ping) {
                storeConfig.stock_discord_regex_role_ping.map((pair) => {
                    const regexpStr = pair[key];
                    const roleId = pair[value].split(",");
                    const regexp = new RegExp(regexpStr, "i");
                    this.stockRegexRolePing.set(regexp, roleId);
                });
            }

            if (storeConfig.cookie_discord_channel || storeConfig.discord_channel) {
                const tempChannel = await this.discordBot?.channels.fetch(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (storeConfig.cookie_discord_channel ?? storeConfig.discord_channel)!
                );
                if (((channel): channel is TextChannel => channel?.type === "GUILD_TEXT")(tempChannel)) {
                    this.cookieChannel = tempChannel;
                }
            }
            if (storeConfig.cookie_discord_role_ping || storeConfig.discord_role_ping) {
                this.cookieRolePing = storeConfig.cookie_discord_role_ping ?? storeConfig.discord_role_ping;
            }

            if (storeConfig.admin_discord_channel || storeConfig.discord_channel) {
                const tempChannel = await this.discordBot?.channels.fetch(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (storeConfig.admin_discord_channel ?? storeConfig.discord_channel)!
                );
                if (((channel): channel is TextChannel => channel?.type === "GUILD_TEXT")(tempChannel)) {
                    this.adminChannel = tempChannel;
                }
            }
            if (storeConfig.admin_discord_role_ping || storeConfig.discord_role_ping) {
                this.adminRolePing = storeConfig.admin_discord_role_ping ?? storeConfig.discord_role_ping;
            }

            if (storeConfig.price_change_discord_channel || storeConfig.discord_channel) {
                const tempChannel = await this.discordBot?.channels.fetch(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (storeConfig.price_change_discord_channel ?? storeConfig.discord_channel)!
                );
                if (((channel): channel is TextChannel => channel?.type === "GUILD_TEXT")(tempChannel)) {
                    this.priceChangeChannel = tempChannel;
                }
            }
            if (storeConfig.price_change_discord_role_ping || storeConfig.discord_role_ping) {
                this.priceChangeRolePing = storeConfig.price_change_discord_role_ping ?? storeConfig.discord_role_ping;
            }

            this.noCookieEmoji = storeConfig.discord_nocookie_emoji;
        });

        this.discordBot.on("rateLimit", (error) => {
            this.logger.error("Discord API error (rateLimit), %O", error);
        });
        this.discordBot.on("error", (error) => {
            this.logger.error("Discord API error (error), %O", error);
        });
        this.discordBot.on("shardError", (error) => {
            this.logger.error("Discord API error (shardError), %O", error);
        });
    }

    private getRolePingsForTitle(title: string) {
        if (this.stockRegexRolePing.size) {
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
            if (rolePings.length < threshold) {
                return [...rolePings, ...(this.stockRolePing?.split(",") ?? [])];
            }
            return rolePings;
        }
        return this.stockRolePing?.split(",");
    }

    private getChannelForTitle(title: string) {
        if (this.stockRegexChannel.size) {
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
            return `${message} <@&${webhookRolePings.toString()}>`;
        }
    }

    private createEmbed(item: Item) {
        const embed = new MessageEmbed().setTimestamp();
        embed.setFooter(`Stockshock v${version} • If you have paid for this, you have been scammed • Links may be affiliate links`);
        if (!item.product) {
            return embed;
        }
        embed.setImage(`https://assets.mmsrg.com/isr/166325/c1/-/${item.product.titleImageId}/mobile_200_200.png`);
        embed.setTitle(item.product.title);
        embed.setURL(`${this.productHelper.getProductURL(item, this.store, this.replacements)}`);
        return embed;
    }
}
