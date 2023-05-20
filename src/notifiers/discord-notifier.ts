import { format, parseISO } from "date-fns";
import type { APIEmbedField, TextChannel } from "discord.js";
import { ActivityType, ChannelType, Client, EmbedBuilder } from "discord.js";
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
    private readonly stockRegexChannel = new Map<RegExp, TextChannel[]>();
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
    private readonly checkInAssortment: boolean;
    private readonly announceCookies: boolean = true;
    private readonly shoppingCartAlerts: boolean = true;
    private readonly showCookiesAmount: boolean = true;
    private readonly showThumbnails: boolean = true;
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
        this.checkInAssortment = storeConfig.check_in_assortment ?? true;
        this.showThumbnails = storeConfig.show_thumbnails ?? false;

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

    async notifyAdmin(message: string): Promise<void> {
        if (this.adminChannel) {
            const storeName = ` [${this.store.getName()}]`;
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            const storeEnrichedMessage = [message.slice(0, 2), storeName, message.slice(2)].join("");
            const decoratedMessage = this.decorateMessageWithRoles(storeEnrichedMessage, this.adminRolePing);
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
                product.title ?? ""
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

    async notifyStock(item?: Item, cookiesAmount?: number): Promise<void> {
        if (!item?.product) {
            return;
        }

        const fullAlert = this.productHelper.isProductBuyable(item, this.checkOnlineStatus, this.checkInAssortment);
        const embed = this.createEmbed(item);

        const price = item.price?.price ?? "0";
        const currency = item.price?.currency ?? "𑿠";
        embed.addFields([
            {
                name: "ProductID",
                value: item.product.id,
                inline: true,
            },
            {
                name: "Price",
                value: `${price} ${currency}`,
                inline: true,
            },
        ]);
        if (this.showMagicianLink) {
            embed.addFields([
                { name: "Magician", value: `${this.productHelper.getProductURL(item, this.store, this.replacements, true)}` },
            ]);
        }
        if (this.showCookiesAmount) {
            embed.addFields([
                { name: "Cookies", value: cookiesAmount ? `${cookiesAmount} 🍪` : `${this.noCookieEmoji ?? "👎"}`, inline: true },
            ]);
        }
        embed.addFields([{ name: "Availability State", value: item.availability.delivery?.availabilityType ?? "UNKNOWN", inline: true }]);

        if (this.showThumbnails) {
            embed.setAuthor({
                name: this.store.getName(),
                iconURL: this.store.thumbnail,
                url: this.productHelper.getProductURL(item, this.store, this.replacements),
            });
        }
        if (item.availability.delivery?.earliest && item.availability.delivery.latest) {
            embed.addFields([
                {
                    name: "Delivery",
                    value:
                        format(parseISO(item.availability.delivery.earliest), "dd.MM.yyyy") +
                        " - " +
                        format(parseISO(item.availability.delivery.latest), "dd.MM.yyyy"),
                },
            ]);
        }
        if (fullAlert) {
            embed.setDescription("🟢 Item **available**");
            embed.setColor("#7ab05e");
        } else if (this.productHelper.canProductBeAddedToBasket(item, this.checkOnlineStatus, this.checkInAssortment)) {
            if (!this.shoppingCartAlerts) {
                return;
            }
            embed.setDescription("🛒 Item **can be added to basket**");
            embed.setColor("#60696f");
        } else {
            embed.setDescription("🟡 Item for **basket parker**");
            embed.setColor("#fcca62");
        }

        const stockChannelsForItem = this.getChannelsForTitle(item.product.title ?? "");
        for (const stockChannelForItem of stockChannelsForItem) {
            if (stockChannelForItem) {
                try {
                    await stockChannelForItem.send({
                        embeds: [embed],
                        content: this.decorateMessageWithRoles(
                            `**[${this.store.getShortName()}]** ${item.product.title ?? ""} now in stock!`,
                            await this.getRolePingsForTitle(item.product.title ?? "", stockChannelForItem)
                        ),
                    });
                } catch (e: unknown) {
                    this.logger.error("Error sending message, error: %O", e);
                }
            }
        }
    }

    async notifyPriceChange(item?: Item, oldPrice?: number): Promise<void> {
        if (item?.product) {
            const embed = this.createEmbed(item);
            const currency = item.price?.currency ?? "𑿠";
            const newPrice = item.price?.price ?? this.zero;
            const delta = oldPrice ? newPrice - oldPrice : newPrice;
            const percentageFactor = 100;
            const precision = 2;
            const deltaPercentage = oldPrice ? ((newPrice - oldPrice) / oldPrice) * percentageFactor : percentageFactor;

            const fields: APIEmbedField[] = [
                { name: "ProductID", value: item.product.id },
                {
                    name: "Old Price",
                    value: oldPrice ? `${oldPrice} ${currency}` : "New product! 😉",
                    inline: true,
                },
                {
                    name: "New Price",
                    value: `${newPrice} ${currency}`,
                    inline: true,
                },
                {
                    name: "Store",
                    value: this.store.getName(),
                    inline: true,
                },
            ];
            embed.addFields(fields);

            if (oldPrice) {
                fields.push({
                    name: "Delta",
                    value: `${delta.toFixed(precision)} ${currency} (${deltaPercentage.toFixed(precision)}%)`,
                    inline: true,
                });
            }

            const emoji = oldPrice ? (delta > this.zero ? "⏫" : "⏬") : "🚨";
            embed.setDescription(oldPrice ? `${emoji} Price change` : `${emoji} New product detected`);
            embed.setColor(delta > this.zero ? "#c31515" : "#7ab05e");

            if (this.priceChangeChannel) {
                try {
                    await this.priceChangeChannel.send({
                        embeds: [embed],
                        content: this.decorateMessageWithRoles(
                            oldPrice
                                ? /* eslint-disable @typescript-eslint/indent */
                                  `${emoji} ${item.product.title ?? "(No title yet)"} [${
                                      item.product.id
                                  }] changed the price from ${oldPrice} ${currency} to ${newPrice} ${currency} (${deltaPercentage.toFixed(
                                      precision
                                  )}%)`
                                : `${emoji} ${item.product.title ?? "(No title yet)"} [${item.product.id}] has been added!`,
                            /* eslint-enable @typescript-eslint/indent */
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
            this.discordBot?.user?.setActivity({
                name: storeConfig.discord_activity_message ?? "eating your cookies. 🍪",
                type: ActivityType.Playing,
            });
            const key = 0;
            const value = 1;

            if (storeConfig.stock_discord_channel || storeConfig.discord_channel) {
                const tempChannel = await this.discordBot?.channels.fetch(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (storeConfig.stock_discord_channel ?? storeConfig.discord_channel)!
                );
                if (((channel): channel is TextChannel => channel?.type === ChannelType.GuildText)(tempChannel)) {
                    this.stockChannel = tempChannel;
                }
            }
            if (storeConfig.stock_discord_regex_channel) {
                storeConfig.stock_discord_regex_channel.map(async (pair) => {
                    const regexpStr = pair[key];
                    const channelIds = pair[value].split(",");
                    const tempChannels: TextChannel[] = [];
                    for (const channelId of channelIds) {
                        const tempChannel = await this.discordBot?.channels.fetch(channelId);
                        if (((channel): channel is TextChannel => channel?.type === ChannelType.GuildText)(tempChannel)) {
                            tempChannels.push(tempChannel);
                        }
                    }
                    const regexp = new RegExp(regexpStr, "i");
                    this.stockRegexChannel.set(regexp, tempChannels);
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
                if (((channel): channel is TextChannel => channel?.type === ChannelType.GuildText)(tempChannel)) {
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
                if (((channel): channel is TextChannel => channel?.type === ChannelType.GuildText)(tempChannel)) {
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
                if (((channel): channel is TextChannel => channel?.type === ChannelType.GuildText)(tempChannel)) {
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

    private async getRolePingsForTitle(title: string, stockChannel: TextChannel) {
        if (this.stockRegexRolePing.size) {
            let threshold = 1;
            const rolePings: string[] = [];
            for (const [regexp, ids] of this.stockRegexRolePing.entries()) {
                if (regexp.test(title)) {
                    for (const id of ids) {
                        if (await stockChannel.guild.roles.fetch(id)) {
                            // In case we have the wildcard role active, increase the threshold for the fallback
                            if (regexp.toString() === "/.*/i") {
                                threshold++;
                            }
                            rolePings.push(id);
                        }
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

    private getChannelsForTitle(title: string) {
        if (this.stockRegexChannel.size) {
            for (const [regexp, channel] of this.stockRegexChannel.entries()) {
                if (regexp.test(title)) {
                    return channel;
                }
            }
        }
        return [this.stockChannel];
    }

    private decorateMessageWithRoles(message: string, webhookRolePings: string[] | string | undefined) {
        if (!webhookRolePings) {
            return message;
        }

        if (Array.isArray(webhookRolePings) && webhookRolePings.length) {
            return `${message} ${webhookRolePings
                .filter(Boolean)
                .map((webhookRolePing) => `<@&${webhookRolePing}>`)
                .join(" ")}`;
        } else if (webhookRolePings.toString()) {
            return `${message} <@&${webhookRolePings.toString()}>`;
        } else {
            return message;
        }
    }

    private createEmbed(item: Item) {
        const embed = new EmbedBuilder().setTimestamp();
        embed.setFooter({
            text: `Stockshock v${version} • Links may be affiliate links`,
        });
        if (!item.product) {
            return embed;
        }
        if (item.product.titleImageId) {
            embed.setThumbnail(`https://assets.mmsrg.com/isr/166325/c1/-/${item.product.titleImageId}/mobile_200_200.png`);
        }

        const url = this.productHelper.getProductURL(item, this.store, this.replacements);
        embed.setTitle(item.product.title ?? url);
        embed.setURL(url);
        return embed;
    }
}
