import { SerializableOrJSHandle } from "puppeteer";
import { v4 } from "uuid";
import { Logger } from "winston";
import { BrowserManager } from "../core/browser-manager";
import { CooldownManager } from "../core/cooldown-manager";
import { DatabaseConnection } from "../databases/database-connection";
import { Item } from "../models/api/item";
import { Product } from "../models/api/product";
import { WishlistResponse } from "../models/api/wishlist-response";
import { Notifier } from "../models/notifier";
import { StoreConfiguration } from "../models/stores/config-model";
import { Store } from "../models/stores/store";
import { ProductHelper } from "../utils/product-helper";
import { GRAPHQL_CLIENT_VERSION, sleep } from "../utils/utils";

export class WishlistChecker {
    // This is set by MM/S and a fixed constant
    readonly MAX_ITEMS_PER_QUERY = 24;

    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifiers: Notifier[] = [];
    private readonly browserManager: BrowserManager;
    private readonly cooldownManager: CooldownManager;
    private readonly productHelper = new ProductHelper();
    private readonly database: DatabaseConnection | undefined;

    constructor(
        store: Store,
        storeConfiguration: StoreConfiguration,
        logger: Logger,
        browserManager: BrowserManager,
        cooldownManager: CooldownManager,
        notifiers: Notifier[],
        database?: DatabaseConnection
    ) {
        this.store = store;
        this.storeConfiguration = storeConfiguration;
        this.logger = logger;
        this.browserManager = browserManager;
        this.cooldownManager = cooldownManager;
        this.notifiers = notifiers;
        this.database = database;
    }

    async checkWishlist(): Promise<Map<string, Product>> {
        if (!this.browserManager.loggedIn) {
            throw new Error("Not logged in!");
        }
        let basketProducts = new Map<string, Product>();

        const res = await this.performWishlistQuery();
        if (res.status !== 200 || !res.body || res.body?.errors) {
            await this.browserManager.handleResponseError("WishlistItems", res);
        } else {
            const totalItems = res.body?.data?.wishlistItems?.total;
            if (!totalItems) {
                throw new Error("Nothing on wishlist!");
            }
            let items = await this.checkItems(res.body?.data?.wishlistItems?.items);
            basketProducts = new Map([...basketProducts, ...items]);

            if (totalItems > this.MAX_ITEMS_PER_QUERY) {
                const remainingQueryCalls = Math.ceil((totalItems - this.MAX_ITEMS_PER_QUERY) / this.MAX_ITEMS_PER_QUERY);
                for (let additionalQueryCalls = 1; additionalQueryCalls <= remainingQueryCalls; additionalQueryCalls += 1) {
                    await sleep(this.store.getSleepTime());
                    const newOffset = additionalQueryCalls * this.MAX_ITEMS_PER_QUERY;
                    const res = await this.performWishlistQuery(newOffset);
                    if (res.status !== 200 || !res.body || res.body?.errors) {
                        await this.browserManager.handleResponseError("WishlistItems", res);
                        if (this.browserManager.reLoginRequired || this.browserManager.reLaunchRequired) {
                            break;
                        }
                    } else {
                        items = await this.checkItems(res.body?.data?.wishlistItems?.items);
                        basketProducts = new Map([...basketProducts, ...items]);
                    }
                }
            }
        }
        return basketProducts;
    }

    private performWishlistQuery(offset = 0): Promise<{
        status: number;
        body: WishlistResponse | null;
        retryAfterHeader?: string | null;
    }> {
        if (!this.browserManager.page) {
            this.logger.error("Unable to perform wishlist query: page is undefined!");
            this.browserManager.reLaunchRequired = true;
            this.browserManager.reLoginRequired = true;
            return Promise.resolve({ status: 0, body: null });
        }
        try {
            return Promise.race([
                this.browserManager.page.evaluate(
                    async (store: Store, offset: number, flowId: string, graphQLClientVersion: string, wishlistSHA256: string) =>
                        await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "GetUser",
                                "x-cacheable": "false",
                                "X-MMS-Language": store.languageCode,
                                "X-MMS-Country": store.countryCode,
                                "X-MMS-Salesline": store.salesLine,
                                "x-flow-id": flowId,
                                Pragma: "no-cache",
                                "Cache-Control": "no-cache",
                            },
                            referrer: `${store.baseUrl}/`,
                            method: "POST",
                            mode: "cors",
                            body: JSON.stringify({
                                operationName: "WishlistItems",
                                variables: {
                                    hasMarketplace: true,
                                    shouldFetchBasket: true,
                                    limit: 24,
                                    offset,
                                },
                                extensions: {
                                    pwa: { salesLine: store.salesLine, country: store.countryCode, language: store.languageCode },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: wishlistSHA256,
                                    },
                                },
                            }),
                        })
                            .then((res) =>
                                res
                                    .json()
                                    .then((data) => ({ status: res.status, body: data }))
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    .catch((_) => ({ status: res.status, body: null, retryAfterHeader: res.headers.get("Retry-After") }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -2, body: null })),
                    this.store as SerializableOrJSHandle,
                    offset,
                    v4(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.wishlistSHA256
                ),
                sleep(10000, {
                    status: -1,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (error) {
            this.logger.error("Unable to perform wishlist query: %O", error);
            return Promise.resolve({ status: 0, body: null });
        }
    }

    private async checkItems(items: Item[] | undefined): Promise<Map<string, Product>> {
        const basketProducts = new Map<string, Product>();

        if (items) {
            for (const item of items) {
                if (!item) {
                    continue;
                }

                if (this.productHelper.isProductAvailable(item)) {
                    const itemId = item?.product?.id;
                    if (!itemId) {
                        continue;
                    }
                    const isProductBuyable = this.productHelper.isProductBuyable(item);

                    // Delete the cooldown in case the stock changes to really available
                    if (!this.cooldownManager.getItem(itemId)?.isProductBuyable && isProductBuyable) {
                        this.cooldownManager.deleteCooldown(itemId);
                    }

                    const lastKnownPrice = this.database ? await this.database.getLastKnownPrice(item.product) : NaN;
                    const price = item.price?.price ?? NaN;
                    if (price && lastKnownPrice && price !== lastKnownPrice) {
                        for (const notifier of this.notifiers) {
                            await notifier.notifyPriceChange(item, lastKnownPrice);
                        }
                    }
                    if (price && price !== lastKnownPrice) {
                        await this.database?.storePrice(item.product, price);
                    }

                    if (!this.cooldownManager.hasCooldown(itemId)) {
                        const cookiesAmount = this.database ? await this.database.getCookiesAmount(item.product) : 0;
                        for (const notifier of this.notifiers) {
                            const message = await notifier.notifyStock(item, cookiesAmount);
                            if (message) {
                                this.logger.info(message);
                            }
                        }
                        this.cooldownManager.addToCooldownMap(isProductBuyable, item, Boolean(cookiesAmount));
                    }

                    if (this.productHelper.canProductBeAddedToBasket(item) && !this.cooldownManager.hasBasketCooldown(itemId)) {
                        basketProducts.set(itemId, item.product);
                    }
                }
            }
        }
        return basketProducts;
    }
}
