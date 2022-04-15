import type { SerializableOrJSHandle } from "puppeteer";
import { v4 } from "uuid";
import type { Logger } from "winston";
import type { BrowserManager } from "../core/browser-manager";
import type { CooldownManager } from "../core/cooldown-manager";
import type { DatabaseConnection } from "../databases/database-connection";
import type { CategoryResponse } from "../models/api/category-response";
import type { Product } from "../models/api/product";
import type { SelectedProductResponse } from "../models/api/selected-product-response";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import type { Store } from "../models/stores/store";
import { HTTPStatusCode } from "../utils/http";
import { ProductHelper } from "../utils/product-helper";
import { GRAPHQL_CLIENT_VERSION, sleep } from "../utils/utils";

export class CategoryChecker {
    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifiers: Notifier[] = [];
    private readonly browserManager: BrowserManager;
    private readonly cooldownManager: CooldownManager;
    private readonly productHelper = new ProductHelper();
    private readonly database: DatabaseConnection | undefined;
    private readonly defaultPage = 0;
    private readonly categoryRaceTimeout = 5000;
    private readonly getProductRaceTimeout = 5000;

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

        const outerCategoryResponse = await this.performCategoryQuery(category);
        if (outerCategoryResponse.status !== HTTPStatusCode.OK || !outerCategoryResponse.body || outerCategoryResponse.body.errors) {
            await this.browserManager.handleResponseError("CategoryV4", outerCategoryResponse);
        } else {
            const totalPages = outerCategoryResponse.body.data?.categoryV4.paging.pageCount;

            if (outerCategoryResponse.body.data?.categoryV4.products) {
                for (const product of outerCategoryResponse.body.data.categoryV4.products) {
                    if (product.productId && (!categoryRegExp || categoryRegExp.test(product.details.title))) {
                        productIds.push(product.productId);
                    }
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            if (totalPages && !Number.isNaN(totalPages) && totalPages > 1) {
                // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                for (let additionalQueryCalls = 2; additionalQueryCalls <= totalPages; additionalQueryCalls += 1) {
                    await sleep(this.store.getSleepTime());
                    const innerCategoryResponse = await this.performCategoryQuery(category, additionalQueryCalls);
                    if (
                        innerCategoryResponse.status !== HTTPStatusCode.OK ||
                        !innerCategoryResponse.body ||
                        innerCategoryResponse.body.errors
                    ) {
                        await this.browserManager.handleResponseError("CategoryV4", innerCategoryResponse);
                        if (this.browserManager.reLoginRequired || this.browserManager.reLaunchRequired) {
                            break;
                        }
                    } else {
                        if (innerCategoryResponse.body.data?.categoryV4.products) {
                            for (const product of innerCategoryResponse.body.data.categoryV4.products) {
                                if (product.productId && (!categoryRegExp || categoryRegExp.test(product.details.title))) {
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
                const productDetailResponse = await this.performProductDetailsQuery(productId);
                if (
                    productDetailResponse.status !== HTTPStatusCode.OK ||
                    !productDetailResponse.body ||
                    productDetailResponse.body.errors
                ) {
                    await this.browserManager.handleResponseError("GetSelectProduct", productDetailResponse);
                    if (this.browserManager.reLoginRequired || this.browserManager.reLaunchRequired) {
                        break;
                    }
                } else {
                    if (productDetailResponse.body.data) {
                        await this.productHelper.checkItem(
                            productDetailResponse.body.data,
                            basketProducts,
                            this.cooldownManager,
                            this.database,
                            this.notifiers,
                            this.storeConfiguration.check_online_status ?? false,
                            this.storeConfiguration.check_in_assortment ?? true,
                            this.storeConfiguration.cookie_ids ?? []
                        );
                    }
                }
                await sleep(this.store.getSleepTime());
            }
        }
        return basketProducts;
    }

    private async performCategoryQuery(
        category: string,
        page = this.defaultPage
    ): Promise<{
        /* eslint-disable @typescript-eslint/indent */
        status: number;
        body: CategoryResponse | null;
        retryAfterHeader?: string | null;
    }> {
        /* eslint-enable @typescript-eslint/indent */
        if (!this.browserManager.page) {
            this.logger.error("Unable to perform category query: page is undefined!");
            return Promise.resolve({ status: 0, body: null });
        }
        let query = "";
        if (this.storeConfiguration.cache_busting ?? true) {
            query = `anti-cache=${new Date().getTime()}`;
        }
        try {
            return await Promise.race([
                this.browserManager.page.evaluate(
                    async (
                        store: Store,
                        pageOffset: number,
                        wcsId: string,
                        flowId: string,
                        graphQLClientVersion: string,
                        categorySHA256: string,
                        queryString: string
                    ) =>
                        fetch(`${store.baseUrl}/api/v1/graphql?${queryString}`, {
                            credentials: "include",
                            headers: {
                                /* eslint-disable @typescript-eslint/naming-convention */
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "CategoryV4",
                                "x-cacheable": "false",
                                "x-mms-language": store.languageCode,
                                "x-mms-country": store.countryCode,
                                "x-mms-salesline": store.salesLine,
                                "x-flow-id": flowId,
                                Pragma: "no-cache",
                                "Cache-Control": "no-cache",
                                /* eslint-enable @typescript-eslint/naming-convention */
                            },
                            referrer: `${store.baseUrl}/`,
                            method: "POST",
                            mode: "cors",
                            body: JSON.stringify({
                                operationName: "CategoryV4",
                                variables: {
                                    hasMarketplace: true,
                                    filters: [],
                                    wcsId,
                                    page: pageOffset,
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
                            .then(async (res) =>
                                res
                                    .json()
                                    .then((data: CategoryResponse) => ({ status: res.status, body: data }))
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    .catch((_) => ({ status: res.status, body: null, retryAfterHeader: res.headers.get("Retry-After") }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -2, body: null })),
                    this.store as SerializableOrJSHandle,
                    page,
                    category,
                    v4(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.categorySHA256,
                    query
                ),
                sleep(this.categoryRaceTimeout, {
                    status: HTTPStatusCode.Timeout,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (error: unknown) {
            this.logger.error("Unable to perform category query: %O", error);
            return Promise.resolve({ status: HTTPStatusCode.Error, body: null });
        }
    }

    private async performProductDetailsQuery(productId: string): Promise<{
        status: number;
        body: SelectedProductResponse | null;
        retryAfterHeader?: string | null;
    }> {
        if (!this.browserManager.page) {
            this.logger.error("Unable to perform get product: page is undefined!");
            return Promise.resolve({ status: 0, body: null });
        }
        let query = "";
        if (this.storeConfiguration.cache_busting ?? true) {
            query = `anti-cache=${new Date().getTime()}`;
        }
        try {
            return await Promise.race([
                this.browserManager.page.evaluate(
                    async (
                        store: Store,
                        id: string,
                        flowId: string,
                        graphQLClientVersion: string,
                        getProductSHA256: string,
                        queryString: string
                    ) =>
                        fetch(`${store.baseUrl}/api/v1/graphql?${queryString}`, {
                            credentials: "include",
                            headers: {
                                /* eslint-disable @typescript-eslint/naming-convention */
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "GetSelectProduct",
                                "x-cacheable": "false",
                                "x-mms-language": store.languageCode,
                                "x-mms-country": store.countryCode,
                                "x-mms-salesline": store.salesLine,
                                "x-flow-id": flowId,
                                Pragma: "no-cache",
                                "Cache-Control": "no-cache",
                                /* eslint-enable @typescript-eslint/naming-convention */
                            },
                            referrer: `${store.baseUrl}/`,
                            method: "POST",
                            mode: "cors",
                            body: JSON.stringify({
                                operationName: "GetSelectProduct",
                                variables: {
                                    hasMarketplace: true,
                                    id,
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
                            .then(async (res) =>
                                res
                                    .json()
                                    .then((data: SelectedProductResponse) => ({ status: res.status, body: data }))
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    .catch((_) => ({ status: res.status, body: null, retryAfterHeader: res.headers.get("Retry-After") }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -2, body: null })),
                    this.store as SerializableOrJSHandle,
                    productId,
                    v4(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.getProductSHA256,
                    query
                ),
                sleep(this.getProductRaceTimeout, {
                    status: HTTPStatusCode.Timeout,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (error: unknown) {
            this.logger.error("Unable to perform get product: %O", error);
            return Promise.resolve({ status: HTTPStatusCode.Error, body: null });
        }
    }
}
