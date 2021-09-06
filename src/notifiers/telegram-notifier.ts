import { format } from "date-fns";
import type { Logger } from "winston";
import { Telegraf } from "telegraf";
import type { Item } from "../models/api/item";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import type { Store } from "../models/stores/store";
import { ProductHelper } from "../utils/product-helper";
import { noop, noopPromise } from "../utils/utils";

export class TelegramNotifier implements Notifier {
    private readonly logger: Logger;
    private readonly productHelper = new ProductHelper();
    private readonly shoppingCartAlerts: boolean = true;
    private readonly store: Store;
    private readonly replacements = new Map<string, string>();
    private telegramBot: Telegraf | undefined = undefined;
    private channelId = "";

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger) {
        this.store = store;
        this.shoppingCartAlerts = storeConfig.shopping_cart_alerts ?? true;
        this.logger = logger;
        if (storeConfig.telegram_bot_api_key && storeConfig.telegram_channel_id) {
            this.setupTelegramBot(storeConfig.telegram_bot_api_key, storeConfig.telegram_channel_id);
        }

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

    async notifyAdmin(): Promise<void> {
        await noopPromise();
    }

    async notifyRateLimit(): Promise<void> {
        await noopPromise();
    }

    async notifyCookies(): Promise<void> {
        await noopPromise();
    }

    async notifyStock(item: Item | undefined): Promise<string | undefined> {
        if (!this.telegramBot || !item?.product) {
            return;
        }

        let message: string;
        const fullAlert = this.productHelper.isProductBuyable(item);
        if (fullAlert) {
            message = this.addTimestamp(
                `\uD83D\uDFE2 Produkt bei ${this.store.getShortName()} verfügbar: \n\n${item.product.title}` +
                    `\n\nPreis : ${item.price?.price ?? "0"} ${item.price?.currency ?? "𑿠"}!` +
                    `\n\n${this.productHelper.getProductURL(item, this.store, this.replacements)}`
            );
        } else if (this.productHelper.canProductBeAddedToBasket(item)) {
            if (!this.shoppingCartAlerts) {
                return;
            }
            message = this.addTimestamp(
                `\uD83D\uDED2 Produkt bei ${this.store.getShortName()} kann zum Warenkorb hinzugefügt werden: ` +
                    `\n\n${item.product.title} ` +
                    `\n\nPreis : ${item.price?.price ?? "0"} ${item.price?.currency ?? "𑿠"}!` +
                    `\n\n${this.productHelper.getProductURL(item, this.store, this.replacements)}`
            );
        } else {
            message = this.addTimestamp(
                `\uD83D\uDFE1 Produkt bei ${this.store.getShortName()} für Warenkorb-Parker: \n\n${item.product.title} ` +
                    `\n\nPreis : ${item.price?.price ?? "0"} ${item.price?.currency ?? "𑿠"}! ` +
                    `\n\n${this.productHelper.getProductURL(item, this.store, this.replacements)}`
            );
        }

        try {
            await this.telegramBot.telegram.sendMessage(this.channelId, message);
        } catch (e: unknown) {
            this.logger.error("Error sending message, %O", e);
        }
        return message;
    }

    async notifyPriceChange(): Promise<void> {
        await noopPromise();
    }

    shutdown(): void {
        noop();
    }

    private setupTelegramBot(apiKey: string, channelId: string) {
        try {
            this.telegramBot = new Telegraf(apiKey);
            this.channelId = channelId;
        } catch (e: unknown) {
            this.logger.error("Error creating Telegram client: %O", e);
        }
    }

    private addTimestamp(message: string) {
        return message + "\n\n" + format(new Date(), " [dd.MM.yyyy HH:mm:ss]");
    }
}
