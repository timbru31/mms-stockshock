import { randomUUID } from "node:crypto";
import type { Logger } from "winston";
import type { BrowserManager } from "../core/browser-manager";
import type { CooldownManager } from "../core/cooldown-manager";
import type { DatabaseConnection } from "../databases/database-connection";
import type { CategoryResponse } from "../models/api/category-response";
import type { Product } from "../models/api/product";
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

    constructor(
        store: Store,
        storeConfiguration: StoreConfiguration,
        logger: Logger,
        browserManager: BrowserManager,
        cooldownManager: CooldownManager,
        notifiers: Notifier[],
        database?: DatabaseConnection,
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
        let basketProducts = new Map<string, Product>();

        const outerCategoryResponse = await this.performCategoryQuery(category);

        if (
            (outerCategoryResponse.status as HTTPStatusCode) !== HTTPStatusCode.OK ||
            !outerCategoryResponse.body ||
            outerCategoryResponse.body.errors
        ) {
            await this.browserManager.handleResponseError("CategoryV4", outerCategoryResponse);
        } else {
            const totalPages = outerCategoryResponse.body.data?.categoryV4.paging.pageCount;

            let products = outerCategoryResponse.body.data?.categoryV4.products
                ?.map((item) => item.cofrProductAggregate)
                .filter((item) => !categoryRegExp || categoryRegExp.test(item.cofrCoreFeature?.productName ?? ""));
            let items = await this.productHelper.checkItems(
                products,
                this.cooldownManager,
                this.database,
                this.notifiers,
                this.store,
                this.storeConfiguration.check_online_status ?? false,
                this.storeConfiguration.check_in_assortment ?? true,
                this.storeConfiguration.cookie_ids ?? [],
            );
            basketProducts = new Map([...basketProducts, ...items]);

            if (totalPages && !Number.isNaN(totalPages) && totalPages > 1) {
                for (let additionalQueryCalls = 2; additionalQueryCalls <= totalPages; additionalQueryCalls += 1) {
                    await sleep(this.store.getSleepTime());
                    const innerCategoryResponse = await this.performCategoryQuery(category, additionalQueryCalls);
                    if (
                        (innerCategoryResponse.status as HTTPStatusCode) !== HTTPStatusCode.OK ||
                        !innerCategoryResponse.body ||
                        innerCategoryResponse.body.errors
                    ) {
                        await this.browserManager.handleResponseError("CategoryV4", innerCategoryResponse);
                        if (this.browserManager.reLoginRequired || this.browserManager.reLaunchRequired) {
                            break;
                        }
                    } else {
                        products = innerCategoryResponse.body.data?.categoryV4.products
                            ?.map((item) => item.cofrProductAggregate)
                            .filter((item) => !categoryRegExp || categoryRegExp.test(item.cofrCoreFeature?.productName ?? ""));
                        items = await this.productHelper.checkItems(
                            products,
                            this.cooldownManager,
                            this.database,
                            this.notifiers,
                            this.store,
                            this.storeConfiguration.check_online_status ?? false,
                            this.storeConfiguration.check_in_assortment ?? true,
                            this.storeConfiguration.cookie_ids ?? [],
                        );
                        basketProducts = new Map([...basketProducts, ...items]);
                    }
                }
            }
        }

        return basketProducts;
    }

    private async performCategoryQuery(
        category: string,
        page = this.defaultPage,
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
            return await Promise.race([
                this.browserManager.page.evaluate(
                    async (
                        store: Store,
                        pageOffset: number,
                        pimCode: string,
                        flowId: string,
                        graphQLClientVersion: string,
                        categorySHA256: string,
                    ) => {
                        const params = new URLSearchParams({
                            operationName: "CategoryV4",
                            variables: JSON.stringify({
                                hasMarketplace: true,
                                isArtificialScarcityActive: true,
                                isCrossLinkingActive: false,
                                shouldIncludeYourekoRatingExp1150: false,
                                locale: `${store.languageCode}-${store.countryCode}`,
                                salesLine: store.salesLine,
                                isRefurbishedGoodsActive: true,
                                isFinancingDisplayActive: true,
                                isPdpFaqSectionActive: true,
                                isDemonstrationModelAvailabilityActive: false,
                                page: pageOffset,
                                filters: [],
                                pimCode,
                                searchExperiment: null,
                                withPerfChanges: true,
                                cofrConfig: {
                                    isEnabled: true,
                                    baseDomain: store.baseUrl,
                                    channel: "DESKTOP",
                                    isLegacyDataExcluded: false,
                                    features: {
                                        badges: {
                                            isFreeShippingBadgeIncluded: false,
                                        },
                                        crossSalesLine: {
                                            isEnabled: false,
                                            isOutputForced: false,
                                        },
                                        onlineStatus: {
                                            isPermanentlyNaIndexEnabled: true,
                                        },
                                        pickup: {
                                            isStrictPickupDisplayStatusEnabled: false,
                                        },
                                        price: {
                                            strikePriceTypes: [
                                                {
                                                    strikePriceType: "lop",
                                                },
                                                {
                                                    strikePriceType: "rrp",
                                                    shouldBeStruck: true,
                                                    showDiscountBadge: true,
                                                    isLegalTextInlineAllowed: false,
                                                },
                                            ],
                                            isBasePriceRequiredFlagRespected: false,
                                            isDiscountLabelEnabled: true,
                                            isDiscountPercentageShown: true,
                                            isDisplayPriceWithStrikePriceRrpThemed: true,
                                            isLongerStrikePricePrefixAllowed: false,
                                            isPromoPriceFiltered: true,
                                            isPromoPriceUsedAsDisplayPriceInApp: false,
                                            isHistoryChartEnabled: false,
                                            discountPercentageMinimum: 10,
                                            discountPercentageMinimumFractionDigits: 0,
                                        },
                                        delivery: {
                                            isDeliveryStatusByEarliestDateEnabled: true,
                                            isLocationSourcingEnabled: true,
                                        },
                                        refurbishedGoods: {
                                            isEnabled: true,
                                        },
                                    },
                                },
                            }),
                            extensions: JSON.stringify({
                                pwa: {
                                    captureChannel: "DESKTOP",
                                    salesLine: store.salesLine,
                                    country: store.countryCode,
                                    language: store.languageCode,
                                    globalLoyaltyProgram: true,
                                    isLoyDowngradeReq: true,
                                    isOneAccountProgramActive: true,
                                    shouldInactiveContractsBeHidden: true,
                                    isUsingXccCustomerComponent: true,
                                    isCheckoutPhoneCompareActive: true,
                                },
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: categorySHA256,
                                },
                            }),
                        });
                        return fetch(`${store.baseUrl}/api/v1/graphql?${params}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client-pqm",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "CategoryV4",
                                "x-cacheable": "true",
                                "x-mms-language": store.languageCode,
                                "x-mms-country": store.countryCode,
                                "x-mms-salesline": store.salesLine,
                                "x-flow-id": flowId,
                                Pragma: "no-cache",
                                "Cache-Control": "no-cache",
                            },
                            referrer: `${store.baseUrl}/`,
                            method: "GET",
                            mode: "cors",
                        })
                            .then(async (res) =>
                                res
                                    .json()
                                    .then((data: CategoryResponse) => ({ status: res.status, body: data }))
                                    .catch((_: unknown) => ({
                                        status: res.status,
                                        body: null,
                                        retryAfterHeader: res.headers.get("Retry-After"),
                                    })),
                            )
                            .catch((_: unknown) => ({ status: -2, body: null }));
                    },
                    this.store,
                    page,
                    category,
                    randomUUID(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.categorySHA256,
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
}
