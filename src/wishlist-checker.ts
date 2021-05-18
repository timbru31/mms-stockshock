import { SerializableOrJSHandle } from "puppeteer";
import { v4 } from "uuid";
import { Logger } from "winston";
import { BrowserManager } from "./browser-manager";
import { CooldownManager } from "./cooldown-manager";

import { Item } from "./models/api/item";
import { WishlistReponse } from "./models/api/wishlist-response";
import { ProductHelper } from "./product-helper";
import { Store } from "./models/stores/store";
import { Notifier } from "./notifier";
import { GRAPHQL_CLIENT_VERSION, sleep } from "./utils";
import { Product } from "./models/api/product";
import { StoreConfiguration } from "./models/stores/config-model";

export class WishlistChecker {
    // This is set by MM/S and a fixed constant
    readonly MAX_ITEMS_PER_QUERY = 24;

    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifier: Notifier;
    private readonly browserManager: BrowserManager;
    private readonly cooldownManager: CooldownManager;
    private readonly productHelper = new ProductHelper();

    constructor(
        store: Store,
        storeConfiguration: StoreConfiguration,
        logger: Logger,
        browserManager: BrowserManager,
        cooldownManager: CooldownManager,
        notifier: Notifier
    ) {
        this.store = store;
        this.storeConfiguration = storeConfiguration;
        this.logger = logger;
        this.browserManager = browserManager;
        this.cooldownManager = cooldownManager;
        this.notifier = notifier;
    }

    async checkWishlist(): Promise<Map<string, Product>> {
        if (!this.browserManager.loggedIn) {
            throw new Error("Not logged in!");
        }
        let cartProducts = new Map<string, Product>();

        const res = await this.performWishlistQuery();
        if (res.status !== 200 || !res.body || res.body?.errors) {
            await this.browserManager.handleResponseError("WishlistItems", res);
        } else {
            const totalItems = res.body?.data?.wishlistItems?.total;
            if (!totalItems) {
                throw new Error("Nothing on wishlist!");
            }
            let items = await this.checkItems(res.body?.data?.wishlistItems?.items);
            cartProducts = new Map([...cartProducts, ...items]);

            if (totalItems > this.MAX_ITEMS_PER_QUERY) {
                const remainingQueryCalls = Math.ceil((totalItems - this.MAX_ITEMS_PER_QUERY) / this.MAX_ITEMS_PER_QUERY);
                for (let additionalQueryCalls = 1; additionalQueryCalls <= remainingQueryCalls; additionalQueryCalls += 1) {
                    await sleep(this.store.getSleepTime());
                    const newOffset = additionalQueryCalls * this.MAX_ITEMS_PER_QUERY;
                    const res = await this.performWishlistQuery(newOffset);
                    if (res.status !== 200 || !res.body || res.body?.errors) {
                        await this.browserManager.handleResponseError("WishlistItems", res);
                    } else {
                        items = await this.checkItems(res.body?.data?.wishlistItems?.items);
                        cartProducts = new Map([...cartProducts, ...items]);
                    }
                }
            }
        }
        return cartProducts;
    }

    private performWishlistQuery(offset = 0): Promise<{
        status: number;
        body: WishlistReponse | null;
        retryAfterHeader: string | null;
    }> {
        try {
            return Promise.race([
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                this.browserManager.page!.evaluate(
                    async (store: Store, offset: number, flowId: string, graphQLClientVersion: string, wishlistSHA256: string) =>
                        await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "GetUser",
                                "x-cacheable": "false",
                                "X-MMS-Language": "de",
                                "X-MMS-Country": store.countryCode,
                                "X-MMS-Salesline": store.salesLine,
                                "x-flow-id": flowId,
                                Pragma: "no-cache",
                                "Cache-Control": "no-cache",
                            },
                            referrer: `${store.baseUrl}/`,
                            method: "POST",
                            body: JSON.stringify({
                                operationName: "WishlistItems",
                                variables: {
                                    hasMarketplace: true,
                                    shouldFetchBasket: true,
                                    limit: 24,
                                    offset,
                                },
                                extensions: {
                                    pwa: { salesLine: store.salesLine, country: store.countryCode, language: "de" },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: wishlistSHA256,
                                    },
                                },
                            }),
                            mode: "cors",
                        })
                            .then((res) =>
                                res
                                    .json()
                                    .then((data) => ({ status: res.status, body: data, retryAfterHeader: null }))
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    .catch((_) => ({ status: res.status, body: null, retryAfterHeader: res.headers.get("Retry-After") }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -1, body: null, retryAfterHeader: null })),
                    this.store as SerializableOrJSHandle,
                    offset,
                    v4(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.wishlistSHA256
                ),
                sleep(5000, {
                    status: 0,
                    retryAfterHeader: null,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (error) {
            this.logger.error("Unable to perform wishlist query: %O", error);
            return Promise.resolve({ status: 0, body: null, retryAfterHeader: null });
        }
    }

    private async checkItems(items: Item[] | undefined): Promise<Map<string, Product>> {
        const cartProducts = new Map<string, Product>();

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

                    if (!this.cooldownManager.hasCooldown(itemId)) {
                        const message = await this.notifier.notifyStock(item);
                        this.logger.info(message);
                        this.cooldownManager.addToCooldownMap(isProductBuyable, item);
                    }

                    if (this.productHelper.canProductBeAddedToCart(item) && !this.cooldownManager.hasCartCooldown(itemId)) {
                        cartProducts.set(itemId, item.product);
                    }
                }
            }
        }
        return cartProducts;
    }
}
