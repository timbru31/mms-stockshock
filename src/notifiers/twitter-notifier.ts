import { format } from "date-fns";
import TwitterApi, { TwitterApiReadWrite } from "twitter-api-v2";
import { Logger } from "winston";
import { Item } from "../models/api/item";
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
    private twitterClient: TwitterApiReadWrite | undefined = undefined;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger) {
        this.store = store;
        this.shoppingCartAlerts = storeConfig.shopping_cart_alerts ?? true;
        this.logger = logger;
        this.tags = storeConfig.twitter_tags ?? [];
        if (
            storeConfig?.twitter_api_key &&
            storeConfig?.twitter_api_key_secret &&
            storeConfig?.twitter_access_token &&
            storeConfig?.twitter_access_token_secret
        ) {
            this.setupTwitterClient(
                storeConfig?.twitter_api_key,
                storeConfig?.twitter_api_key_secret,
                storeConfig.twitter_access_token,
                storeConfig.twitter_access_token_secret
            );
        }

        if (storeConfig.id_replacements) {
            storeConfig.id_replacements.map((pair) => {
                const id = pair[0];
                const url = pair[1];
                this.replacements.set(id, url);
            });
        }
    }

    async notifyAdmin(): Promise<void> {
        return noop();
    }

    async notifyRateLimit(): Promise<void> {
        return noop();
    }

    async notifyCookies(): Promise<void> {
        return noop();
    }

    async notifyStock(item: Item): Promise<string | undefined> {
        if (!this.twitterClient) {
            return;
        }

        let message: string;
        const fullAlert = this.productHelper.isProductBuyable(item);
        if (fullAlert) {
            message = this.addTimestamp(
                this.decorateMessageWithTags(
                    `\uD83D\uDFE2 Produkt bei ${this.store.getShortName()} verfügbar: ${item?.product?.title} für ${
                        item?.price?.price ?? "0"
                    } ${item?.price?.currency ?? "𑿠"}! Jetzt kaufen: ${this.productHelper.getProductURL(
                        item,
                        this.store,
                        this.replacements
                    )}`
                )
            );
        } else if (this.productHelper.canProductBeAddedToBasket(item)) {
            if (!this.shoppingCartAlerts) {
                return;
            }
            message = this.addTimestamp(
                this.decorateMessageWithTags(
                    `\uD83D\uDED2 Produkt bei ${this.store.getShortName()} kann zum Warenkorb hinzugefügt werden: ${
                        item?.product?.title
                    } für ${item?.price?.price ?? "0"} ${item?.price?.currency ?? "𑿠"}! Jetzt anschauen: ${this.productHelper.getProductURL(
                        item,
                        this.store,
                        this.replacements
                    )}`
                )
            );
        } else {
            message = this.addTimestamp(
                this.decorateMessageWithTags(
                    `\uD83D\uDFE1 Produkt bei ${this.store.getShortName()} für Warenkorb-Parker: ${item?.product?.title} für ${
                        item?.price?.price ?? "0"
                    } ${item?.price?.currency ?? "𑿠"}! Jetzt anschauen: ${this.productHelper.getProductURL(
                        item,
                        this.store,
                        this.replacements
                    )}`
                )
            );
        }

        try {
            await this.twitterClient.v1.tweet(message);
        } catch (e) {
            this.logger.error("Error creating tweet, %O", e);
        }
        return message;
    }

    shutdown(): void {
        return noop();
    }

    private setupTwitterClient(apiKey: string, apiKeySecret: string, accessToken: string, accessTokenSecret: string) {
        try {
            this.twitterClient = new TwitterApi({
                appKey: apiKey,
                appSecret: apiKeySecret,
                accessToken: accessToken,
                accessSecret: accessTokenSecret,
            }).readWrite;
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

    private addTimestamp(message: string) {
        return message + format(new Date(), " [dd.MM.yyyy HH:mm:ss]");
    }
}
