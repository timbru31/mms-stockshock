import type { Logger } from "winston";
import type { CofrProductAggregate } from "../models/api/product-aggregate";
import type { Product } from "../models/api/product";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import type { Store } from "../models/stores/store";
import { ProductHelper } from "../utils/product-helper";
import { noop } from "../utils/utils";

export class LoggerNotifier implements Notifier {
    private readonly checkOnlineStatus: boolean;
    private readonly checkInAssortment: boolean;
    private readonly store: Store;
    private readonly logger: Logger;
    private readonly productHelper = new ProductHelper();
    private readonly zero = 0;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger) {
        this.store = store;

        this.checkOnlineStatus = storeConfig.check_online_status ?? false;
        this.checkInAssortment = storeConfig.check_in_assortment ?? true;

        this.logger = logger;
    }

    async notifyAdmin(message: string, error?: unknown): Promise<void> {
        this.logger.info(message + (error ? ", %O" : ""), error);

        return Promise.resolve(undefined);
    }

    async notifyRateLimit(seconds?: number): Promise<void> {
        const fiveMinutesInSeconds = 300;
        if (seconds && seconds > fiveMinutesInSeconds) {
            const precision = 2;
            const minutesFactor = 60;
            const message = `💤 [${this.store.getName()}] Too many requests, we need to pause ${(seconds / minutesFactor).toFixed(
                precision,
            )} minutes... 😴`;

            this.logger.info(message);
        }
        return Promise.resolve(undefined);
    }

    async notifyCookies(product?: Product, cookies?: string[]): Promise<void> {
        if (product && cookies) {
            const message = `🍪 ${cookies.length} basket cookies were made for **${product.id}**, **${
                product.title ?? product.id
            }** for ${this.store.getName()}`;
            this.logger.info(message);
        }
        return Promise.resolve(undefined);
    }

    async notifyStock(item?: CofrProductAggregate): Promise<void> {
        if (!item?.productId) {
            return;
        }
        let message: string;
        const fullAlert = this.productHelper.isProductBuyable(item, this.checkOnlineStatus, this.checkInAssortment);

        const price = item.cofrPriceFeature?.price?.amount ?? "0";
        const currency = item.cofrPriceFeature?.currency ?? "𑿠";
        if (fullAlert) {
            message = `🟢 Item **available**: ${item.productId}, ${
                item.cofrCoreFeature?.productName ?? item.productId
            } for ${price} ${currency}! Go check it out: ${this.productHelper.getProductURL(item, this.store, undefined, true)}`;
        } else if (this.productHelper.canProductBeAddedToBasket(item, this.checkOnlineStatus, this.checkInAssortment)) {
            message = `🛒 Item **can be added to basket**: ${item.productId}, ${
                item.cofrCoreFeature?.productName ?? item.productId
            } for ${price} ${currency}! Go check it out: ${this.productHelper.getProductURL(item, this.store, undefined, true)}`;
        } else {
            message = `🟡 Item for **basket parker**: ${item.productId}, ${
                item.cofrCoreFeature?.productName ?? item.productId
            } for ${price} ${currency}! Go check it out: ${this.productHelper.getProductURL(item, this.store)}`;
        }
        this.logger.info(message);
        return Promise.resolve(undefined);
    }

    async notifyPriceChange(item?: CofrProductAggregate, oldPrice?: number): Promise<void> {
        if (item?.productId && oldPrice) {
            const currency = item.cofrPriceFeature?.currency ?? "𑿠";
            const newPrice = item.cofrPriceFeature?.price?.amount ?? this.zero;
            const delta = newPrice - oldPrice;
            const percentageFactor = 100;
            const precision = 2;
            const deltaPercentage = ((newPrice - oldPrice) / oldPrice) * percentageFactor;

            const emoji = delta > this.zero ? "⏫" : "⏬";

            const message = `${emoji} ${item.cofrCoreFeature?.productName ?? item.productId} [${
                item.productId
            }] changed the price from ${oldPrice} ${currency} to ${newPrice} ${currency} (${deltaPercentage.toFixed(precision)}%)`;

            this.logger.info(message);
        }
        return Promise.resolve(undefined);
    }

    shutdown(): void {
        noop();
    }
}
