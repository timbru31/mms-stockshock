import { randomUUID } from "node:crypto";
import type { Logger } from "winston";
import type { BrowserManager } from "../core/browser-manager";
import type { CooldownManager } from "../core/cooldown-manager";
import type { DatabaseConnection } from "../databases/database-connection";
import type { SearchResponse } from "../models/api/search-response";
import type { Product } from "../models/api/product";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import type { Store } from "../models/stores/store";
import { HTTPStatusCode } from "../utils/http";
import { ProductHelper } from "../utils/product-helper";
import { GRAPHQL_CLIENT_VERSION, sleep } from "../utils/utils";

export class SearchChecker {
    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifiers: Notifier[] = [];
    private readonly browserManager: BrowserManager;
    private readonly cooldownManager: CooldownManager;
    private readonly productHelper = new ProductHelper();
    private readonly database: DatabaseConnection | undefined;
    private readonly defaultPage = 0;
    private readonly searchRaceTimeout = 5000;

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

    async checkSearch(search: string, searchRegex?: string, priceRange?: number[]): Promise<Map<string, Product>> {
        let searchRegexp: RegExp | null = null;
        if (searchRegex) {
            searchRegexp = new RegExp(searchRegex, "i");
        }
        let basketProducts = new Map<string, Product>();

        const outerSearchResponse = await this.performSearchQuery(search, priceRange);

        if (
            (outerSearchResponse.status as HTTPStatusCode) !== HTTPStatusCode.OK ||
            !outerSearchResponse.body ||
            outerSearchResponse.body.errors
        ) {
            await this.browserManager.handleResponseError("SearchV4", outerSearchResponse);
        } else {
            const totalPages = outerSearchResponse.body.data?.searchV4.paging.pageCount;

            let products = outerSearchResponse.body.data?.searchV4.products
                ?.map((item) => item.cofrProductAggregate)
                .filter((item) => !searchRegexp || searchRegexp.test(item.cofrCoreFeature?.productName ?? ""));
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
                    const innerSearchResponse = await this.performSearchQuery(search, priceRange, additionalQueryCalls);
                    if (
                        (innerSearchResponse.status as HTTPStatusCode) !== HTTPStatusCode.OK ||
                        !innerSearchResponse.body ||
                        innerSearchResponse.body.errors
                    ) {
                        await this.browserManager.handleResponseError("SearchV4", innerSearchResponse);
                        if (this.browserManager.reLoginRequired || this.browserManager.reLaunchRequired) {
                            break;
                        }
                    } else {
                        products = innerSearchResponse.body.data?.searchV4.products
                            ?.map((item) => item.cofrProductAggregate)
                            .filter((item) => !searchRegexp || searchRegexp.test(item.cofrCoreFeature?.productName ?? ""));
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

    private async performSearchQuery(
        searchQuery: string,
        priceRange?: number[],
        page = this.defaultPage,
    ): Promise<{
        status: number;
        body: SearchResponse | null;
        retryAfterHeader?: string | null;
    }> {
        if (!this.browserManager.page) {
            this.logger.error("Unable to perform search query: page is undefined!");
            return Promise.resolve({ status: 0, body: null });
        }
        try {
            return await Promise.race([
                this.browserManager.page.evaluate(
                    async (
                        store: Store,
                        pageOffset: number,
                        query: string,
                        range: number[],
                        flowId: string,
                        graphQLClientVersion: string,
                        searchSHA256: string,
                    ) => {
                        const params = new URLSearchParams({
                            operationName: "SearchV4",
                            variables: JSON.stringify({
                                bypassStandardization: false,
                                hasMarketplace: true,
                                isArtificialScarcityActive: true,
                                shouldIncludeYourekoRatingExp1150: false,
                                locale: store.locale,
                                salesLine: store.salesLine,
                                isRefurbishedGoodsActive: true,
                                isFinancingDisplayActive: true,
                                isPdpFaqSectionActive: true,
                                isDemonstrationModelAvailabilityActive: false,
                                isCrossLinkingActive: false,
                                query,
                                page: pageOffset,
                                filters: range.length === 2 ? [`currentprice:${range[0]}-${range[1]}`] : [],
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
                                    sha256Hash: searchSHA256,
                                },
                            }),
                        });
                        return fetch(`${store.baseUrl}/api/v1/graphql?${params}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client-pqm",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "SearchV4",
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
                                    .then((data: SearchResponse) => ({ status: res.status, body: data }))
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
                    searchQuery,
                    priceRange ?? [],
                    randomUUID(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.searchSHA256,
                ),
                sleep(this.searchRaceTimeout, {
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
