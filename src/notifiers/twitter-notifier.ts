/* eslint-disable @typescript-eslint/no-unused-vars */
import TwitterApi from "twitter-api-v2";
import { Logger } from "winston";
import { Item } from "../models/api/item";
import { Product } from "../models/api/product";
import { Notifier } from "../models/notifier";
import { StoreConfiguration } from "../models/stores/config-model";
import { Store } from "../models/stores/store";
import { ProductHelper } from "../utils/product-helper";
import { noop } from "../utils/utils";

export class TwitterNotifier implements Notifier {
    private readonly logger: Logger;
    private readonly productHelper = new ProductHelper();
    private readonly shoppingCartAlerts: boolean = true;
    private readonly store: Store;
    private readonly tags: string[];
    private readonly replacements = new Map<string, string>();
    private twitterClient: TwitterApi | undefined = undefined;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger) {
        this.store = store;
        this.shoppingCartAlerts = storeConfig.shopping_cart_alerts ?? true;
        this.logger = logger;
        this.tags = storeConfig.twitter_tags ?? [];
        if (storeConfig.twitter_bearer_token) {
            this.setupTwitterClient(storeConfig.twitter_bearer_token);
        }

        if (storeConfig.id_replacements) {
            storeConfig.id_replacements.map((pair) => {
                const id = pair[0];
                const url = pair[1];
                this.replacements.set(id, url);
            });
        }
    }

    async notifyAdmin(_: string): Promise<void> {
        return noop();
    }

    async notifyRateLimit(_: number): Promise<void> {
        return noop();
    }

    async notifyCookies(_: Product, __: string[]): Promise<void> {
        return noop();
    }

    async notifyStock(item: Item): Promise<string | undefined> {
        if (!this.twitterClient) {
            return;
        }

        let message: string;
        const fullAlert = this.productHelper.isProductBuyable(item);
        if (fullAlert) {
            message = this.decorateMessageWithTags(
                `🟢 Item **available**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item, this.replacements)}`
            );
        } else if (this.productHelper.canProductBeAddedToBasket(item)) {
            if (!this.shoppingCartAlerts) {
                return;
            }
            message = this.decorateMessageWithTags(
                `🛒 Item **can be added to basket**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item, this.replacements)}`
            );
        } else {
            message = this.decorateMessageWithTags(
                `🟡 Item for **basket parker**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price ?? "0"} ${
                    item?.price?.currency ?? "𑿠"
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item, this.replacements)}`
            );
        }

        this.twitterClient.v1.tweet(message);
        return message;
    }

    shutdown(): void {
        return noop();
    }

    private setupTwitterClient(token: string) {
        try {
            this.twitterClient = new TwitterApi(token);
        } catch (e) {
            this.logger.error("Error creating twitter client: %O", e);
        }
    }

    private decorateMessageWithTags(message: string) {
        if (this.tags?.length) {
            return message + "\n" + this.tags.join(" ");
        }
        return message;
    }
}
