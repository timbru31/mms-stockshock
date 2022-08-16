import { format } from "date-fns";
import type { TwitterApiReadWrite } from "twitter-api-v2";
import { TwitterApi } from "twitter-api-v2";
import type { Logger } from "winston";
import type { Item } from "../models/api/item.js";
import type { Notifier } from "../models/notifier.js";
import type { StoreConfiguration } from "../models/stores/config-model.js";
import type { Store } from "../models/stores/store.js";
import { ProductHelper } from "../utils/product-helper.js";
import { noop, noopPromise } from "../utils/utils.js";

export class TwitterNotifier implements Notifier {
    private readonly logger: Logger;
    private readonly productHelper = new ProductHelper();
    private readonly shoppingCartAlerts: boolean = true;
    private readonly checkOnlineStatus: boolean;
    private readonly checkInAssortment: boolean;
    private readonly store: Store;
    private readonly tags: string[];
    private readonly replacements = new Map<string, string>();
    private twitterClient: TwitterApiReadWrite | undefined = undefined;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger) {
        this.store = store;
        this.shoppingCartAlerts = storeConfig.shopping_cart_alerts ?? true;
        this.checkOnlineStatus = storeConfig.check_online_status ?? false;
        this.checkInAssortment = storeConfig.check_in_assortment ?? true;
        this.logger = logger;
        this.tags = storeConfig.twitter_tags ?? [];
        if (
            storeConfig.twitter_api_key &&
            storeConfig.twitter_api_key_secret &&
            storeConfig.twitter_access_token &&
            storeConfig.twitter_access_token_secret
        ) {
            this.setupTwitterClient(
                storeConfig.twitter_api_key,
                storeConfig.twitter_api_key_secret,
                storeConfig.twitter_access_token,
                storeConfig.twitter_access_token_secret
            );
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

    async notifyStock(item: Item | undefined): Promise<void> {
        if (!this.twitterClient || !item?.product) {
            return;
        }

        let message: string;
        const fullAlert = this.productHelper.isProductBuyable(item, this.checkOnlineStatus, this.checkInAssortment);
        if (fullAlert) {
            message = this.addTimestamp(
                this.decorateMessageWithTags(
                    `\uD83D\uDFE2 Produkt bei ${this.store.getShortName()} verfügbar: ${item.product.title} für ${
                        item.price?.price ?? "0"
                    } ${item.price?.currency ?? "𑿠"}! Jetzt kaufen: ${this.productHelper.getProductURL(
                        item,
                        this.store,
                        this.replacements
                    )} \uFF0A`
                )
            );
        } else if (this.productHelper.canProductBeAddedToBasket(item, this.checkOnlineStatus, this.checkInAssortment)) {
            if (!this.shoppingCartAlerts) {
                return;
            }
            message = this.addTimestamp(
                this.decorateMessageWithTags(
                    `\uD83D\uDED2 Produkt bei ${this.store.getShortName()} kann zum Warenkorb hinzugefügt werden: ${
                        item.product.title
                    } für ${item.price?.price ?? "0"} ${item.price?.currency ?? "𑿠"}! Jetzt anschauen: ${this.productHelper.getProductURL(
                        item,
                        this.store,
                        this.replacements
                    )} \uFF0A`
                )
            );
        } else {
            message = this.addTimestamp(
                this.decorateMessageWithTags(
                    `\uD83D\uDFE1 Produkt bei ${this.store.getShortName()} für Warenkorb-Parker: ${item.product.title} für ${
                        item.price?.price ?? "0"
                    } ${item.price?.currency ?? "𑿠"}! Jetzt anschauen: ${this.productHelper.getProductURL(
                        item,
                        this.store,
                        this.replacements
                    )} \uFF0A`
                )
            );
        }

        try {
            await this.twitterClient.v1.tweet(message);
        } catch (e: unknown) {
            this.logger.error("Error creating tweet, %O", e);
        }
    }

    async notifyPriceChange(): Promise<void> {
        await noopPromise();
    }

    shutdown(): void {
        noop();
    }

    private setupTwitterClient(apiKey: string, apiKeySecret: string, accessToken: string, accessTokenSecret: string) {
        try {
            this.twitterClient = new TwitterApi({
                appKey: apiKey,
                appSecret: apiKeySecret,
                accessToken: accessToken,
                accessSecret: accessTokenSecret,
            }).readWrite;
        } catch (e: unknown) {
            this.logger.error("Error creating twitter client: %O", e);
        }
    }

    private decorateMessageWithTags(message: string) {
        if (this.tags.length) {
            return message + "\n" + this.tags.join(" ");
        }
        return message;
    }

    private addTimestamp(message: string) {
        return message + format(new Date(), " [dd.MM.yyyy HH:mm:ss]");
    }
}
