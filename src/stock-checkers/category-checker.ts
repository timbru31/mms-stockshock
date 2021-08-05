import { SerializableOrJSHandle } from "puppeteer";
import { v4 } from "uuid";
import { Logger } from "winston";
import { BrowserManager } from "../core/browser-manager";
import { CooldownManager } from "../core/cooldown-manager";

import { Item } from "../models/api/item";
import { ProductHelper } from "../utils/product-helper";
import { Store } from "../models/stores/store";
import { GRAPHQL_CLIENT_VERSION, sleep } from "../utils/utils";
import { CategoryResponse } from "../models/api/category-response";
import { Product } from "../models/api/product";
import { SelectedProductResponse } from "../models/api/selected-product-response";
import { StoreConfiguration } from "../models/stores/config-model";
import { Notifier } from "../models/notifier";
import { DatabaseConnection } from "../databases/database-connection";

export class CategoryChecker {
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

    async checkCategory(category: string, categoryRegex?: string): Promise<Map<string, Product>> {
        let categoryRegExp: RegExp | null = null;
        if (categoryRegex) {
            categoryRegExp = new RegExp(categoryRegex, "i");
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

            if (totalPages && !Number.isNaN(totalPages) && totalPages > 1) {
                for (let additionalQueryCalls = 2; additionalQueryCalls <= totalPages; additionalQueryCalls += 1) {
                    await sleep(this.store.getSleepTime());
                    const res = await this.performCategoryQuery(category, additionalQueryCalls);
                    if (res.status !== 200 || !res.body || res.body?.errors) {
                        await this.browserManager.handleResponseError("CategoryV4", res);
                        if (this.browserManager.reLoginRequired || this.browserManager.reLaunchRequired) {
                            break;
                        }
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
                    if (this.browserManager.reLoginRequired || this.browserManager.reLaunchRequired) {
                        break;
                    }
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
        if (!this.browserManager.page) {
            this.logger.error("Unable to perform category query: page is undefined!");
            return Promise.resolve({ status: 0, body: null });
        }
        try {
            return Promise.race([
                this.browserManager.page.evaluate(
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
                                operationName: "CategoryV4",
                                variables: {
                                    hasMarketplace: true,
                                    filters: [],
                                    wcsId: category,
                                    page,
                                },
                                extensions: {
                                    pwa: {
                                        salesLine: store.salesLine,
                                        country: store.countryCode,
                                        language: store.languageCode,
                                        contentful: true,
                                    },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: categorySHA256,
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
            this.logger.error("Unable to perform category query: %O", error);
            return Promise.resolve({ status: 0, body: null });
        }
    }

    private performProductDetailsQuery(productId: string): Promise<{
        status: number;
        body: SelectedProductResponse | null;
        retryAfterHeader?: string | null;
    }> {
        if (!this.browserManager.page) {
            this.logger.error("Unable to perform get product: page is undefined!");
            return Promise.resolve({ status: 0, body: null });
        }
        try {
            return Promise.race([
                this.browserManager.page.evaluate(
                    async (store: Store, productId: string, flowId: string, graphQLClientVersion: string, getProductSHA256: string) =>
                        await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "GetSelectProduct",
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
                                operationName: "GetSelectProduct",
                                variables: {
                                    hasMarketplace: true,
                                    id: productId,
                                },
                                extensions: {
                                    pwa: {
                                        salesLine: store.salesLine,
                                        country: store.countryCode,
                                        language: store.languageCode,
                                        contentful: true,
                                    },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: getProductSHA256,
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
            this.logger.error("Unable to perform get product: %O", error);
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
                const cookiesAmount = this.database ? await this.database.getCookiesAmount(item.product) : 0;
                const lastKnownPrice = this.database ? await this.database.getLastKnownPrice(item.product) : NaN;
                const price = item.price?.price ?? NaN;
                for (const notifier of this.notifiers) {
                    const message = await notifier.notifyStock(item, cookiesAmount);
                    if (message) {
                        this.logger.info(message);
                    }
                    if (price && lastKnownPrice && price !== lastKnownPrice) {
                        await notifier.notifyPriceChange(item, lastKnownPrice);
                    }
                }
                if (price && price !== lastKnownPrice) {
                    await this.database?.storePrice(item.product, price);
                }
                this.cooldownManager.addToCooldownMap(isProductBuyable, item, Boolean(cookiesAmount));
            }

            if (this.productHelper.canProductBeAddedToBasket(item) && !this.cooldownManager.hasBasketCooldown(itemId)) {
                basketProducts.set(itemId, item.product);
            }
        }
        return basketProducts;
    }
}
