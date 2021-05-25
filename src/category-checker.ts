import { SerializableOrJSHandle } from "puppeteer";
import { v4 } from "uuid";
import { Logger } from "winston";
import { BrowserManager } from "./browser-manager";
import { CooldownManager } from "./cooldown-manager";

import { Item } from "./models/api/item";
import { ProductHelper } from "./product-helper";
import { Store } from "./models/stores/store";
import { Notifier } from "./notifier";
import { GRAPHQL_CLIENT_VERSION, sleep } from "./utils";
import { CategoryResponse } from "./models/api/category-response";
import { Product } from "./models/api/product";
import { SelectedProductResponse } from "./models/api/selected-product-response";
import { StoreConfiguration } from "./models/stores/config-model";

export class CategoryChecker {
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

    async checkCategory(category: string, categoryRegex?: string): Promise<Map<string, Product>> {
        let categoryRegExp: RegExp | null = null;
        if (categoryRegex) {
            categoryRegExp = new RegExp(categoryRegex, "i");
        }
        if (!this.browserManager.loggedIn) {
            throw new Error("Not logged in!");
        }
        const basketProducts = new Map<string, Product>();
        const productIds: string[] = [];

        const res = await this.performCategoryQuery(category);
        if (res.status !== 200 || !res.body || res.body?.errors) {
            await this.browserManager.handleResponseError("CategoryV4", res);
        } else {
            const totalPages = res.body?.data?.categoryV4?.paging?.pageCount;

            if (res?.body?.data?.categoryV4?.products) {
                for (const product of res.body.data.categoryV4.products) {
                    if (product?.productId && (!categoryRegExp || categoryRegExp.test(product?.details?.title))) {
                        productIds.push(product.productId);
                    }
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (totalPages && !Number.isNaN(totalPages) && totalPages > 1) {
                for (let additionalQueryCalls = 2; additionalQueryCalls <= totalPages; additionalQueryCalls += 1) {
                    await sleep(this.store.getSleepTime());
                    const res = await this.performCategoryQuery(category, additionalQueryCalls);
                    if (res.status !== 200 || !res.body || res.body?.errors) {
                        await this.browserManager.handleResponseError("CategoryV4", res);
                    } else {
                        if (res?.body?.data?.categoryV4?.products) {
                            for (const product of res.body.data.categoryV4.products) {
                                if (product?.productId && (!categoryRegExp || categoryRegExp.test(product?.details?.title))) {
                                    productIds.push(product.productId);
                                }
                            }
                        }
                    }
                }
            }
        }
        if (productIds.length) {
            for (const productId of productIds) {
                const res = await this.performProductDetailsQuery(productId);
                if (res.status !== 200 || !res.body || res.body?.errors) {
                    await this.browserManager.handleResponseError("GetSelectProduct", res);
                } else {
                    if (res?.body?.data) {
                        await this.checkItem(res.body.data, basketProducts);
                    }
                }
                await sleep(this.store.getSleepTime());
            }
        }
        return basketProducts;
    }

    private performCategoryQuery(
        category: string,
        page = 0
    ): Promise<{
        status: number;
        body: CategoryResponse | null;
        retryAfterHeader?: string | null;
    }> {
        try {
            return Promise.race([
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                this.browserManager.page!.evaluate(
                    async (
                        store: Store,
                        page: number,
                        category: string,
                        flowId: string,
                        graphQLClientVersion: string,
                        categorySHA256: string
                    ) =>
                        await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "CategoryV4",
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
                                operationName: "CategoryV4",
                                variables: {
                                    hasMarketplace: true,
                                    filters: [],
                                    wcsId: category,
                                    page,
                                },
                                extensions: {
                                    pwa: { salesLine: store.salesLine, country: store.countryCode, language: "de", contentful: true },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: categorySHA256,
                                    },
                                },
                            }),
                            mode: "cors",
                        })
                            .then((res) =>
                                res
                                    .json()
                                    .then((data) => ({ status: res.status, body: data }))
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    .catch((_) => ({ status: res.status, body: null, retryAfterHeader: res.headers.get("Retry-After") }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -1, body: null })),
                    this.store as SerializableOrJSHandle,
                    page,
                    category,
                    v4(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.categorySHA256
                ),
                sleep(5000, {
                    status: 0,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (error) {
            this.logger.error("Unable to perform wishlist query: %O", error);
            return Promise.resolve({ status: 0, body: null });
        }
    }

    private performProductDetailsQuery(productId: string): Promise<{
        status: number;
        body: SelectedProductResponse | null;
        retryAfterHeader?: string | null;
    }> {
        try {
            return Promise.race([
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                this.browserManager.page!.evaluate(
                    async (store: Store, productId: string, flowId: string, graphQLClientVersion: string, getProductSHA256: string) =>
                        await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "GetSelectProduct",
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
                                operationName: "GetSelectProduct",
                                variables: {
                                    hasMarketplace: true,
                                    id: productId,
                                },
                                extensions: {
                                    pwa: { salesLine: store.salesLine, country: store.countryCode, language: "de", contentful: true },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: getProductSHA256,
                                    },
                                },
                            }),
                            mode: "cors",
                        })
                            .then((res) =>
                                res
                                    .json()
                                    .then((data) => ({ status: res.status, body: data }))
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    .catch((_) => ({ status: res.status, body: null, retryAfterHeader: res.headers.get("Retry-After") }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -1, body: null })),
                    this.store as SerializableOrJSHandle,
                    productId,
                    v4(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.getProductSHA256
                ),
                sleep(5000, {
                    status: 0,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (error) {
            this.logger.error("Unable to perform wishlist query: %O", error);
            return Promise.resolve({ status: 0, body: null });
        }
    }

    private async checkItem(item: Item | undefined, basketProducts: Map<string, Product>): Promise<Map<string, Product>> {
        if (!item) {
            return basketProducts;
        }

        if (this.productHelper.isProductAvailable(item)) {
            const itemId = item?.product?.id;
            if (!itemId) {
                return basketProducts;
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

            if (this.productHelper.canProductBeAddedToBasket(item) && !this.cooldownManager.hasBasketCooldown(itemId)) {
                basketProducts.set(itemId, item.product);
            }
        }
        return basketProducts;
    }
}
