import { randomUUID } from "node:crypto";
import type { Logger } from "winston";
import type { BrowserManager } from "../core/browser-manager";
import type { CooldownManager } from "../core/cooldown-manager";
import type { DatabaseConnection } from "../databases/database-connection";
import type { Product } from "../models/api/product";
import type { WishlistResponse } from "../models/api/wishlist-response";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import type { Store } from "../models/stores/store";
import { HTTPStatusCode } from "../utils/http";
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
    private readonly defaultOffset = 0;
    private readonly wishlistRaceTimeout = 10000;

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

    async checkWishlist(): Promise<Map<string, Product>> {
        if (!this.browserManager.loggedIn) {
            throw new Error("Not logged in!");
        }
        let basketProducts = new Map<string, Product>();

        const res = await this.performWishlistQuery();
        if ((res.status as HTTPStatusCode) !== HTTPStatusCode.OK || !res.body || res.body.errors) {
            await this.browserManager.handleResponseError("WishlistItems", res);
        } else {
            const totalItems = res.body.data?.wishlistItems?.total;
            if (!totalItems) {
                throw new Error("Nothing on wishlist!");
            }
            let items = await this.productHelper.checkItems(
                res.body.data?.wishlistItems?.items.map((item) => item.cofrProductAggregate),
                this.cooldownManager,
                this.database,
                this.notifiers,
                this.store,
                this.storeConfiguration.check_online_status ?? false,
                this.storeConfiguration.check_in_assortment ?? true,
                this.storeConfiguration.cookie_ids ?? [],
            );
            basketProducts = new Map([...basketProducts, ...items]);

            if (totalItems > this.MAX_ITEMS_PER_QUERY) {
                const remainingQueryCalls = Math.ceil((totalItems - this.MAX_ITEMS_PER_QUERY) / this.MAX_ITEMS_PER_QUERY);
                for (let additionalQueryCalls = 1; additionalQueryCalls <= remainingQueryCalls; additionalQueryCalls += 1) {
                    await sleep(this.store.getSleepTime());
                    const newOffset = additionalQueryCalls * this.MAX_ITEMS_PER_QUERY;
                    const innerResponse = await this.performWishlistQuery(newOffset);
                    if (
                        (innerResponse.status as HTTPStatusCode) !== HTTPStatusCode.OK ||
                        !innerResponse.body ||
                        innerResponse.body.errors
                    ) {
                        await this.browserManager.handleResponseError("WishlistItems", innerResponse);
                        if (this.browserManager.reLoginRequired || this.browserManager.reLaunchRequired) {
                            break;
                        }
                    } else {
                        items = await this.productHelper.checkItems(
                            innerResponse.body.data?.wishlistItems?.items.map((item) => item.cofrProductAggregate),
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

    private async performWishlistQuery(offset = this.defaultOffset): Promise<{
        status: number;
        body: WishlistResponse | null;
        retryAfterHeader?: string | null;
    }> {
        if (!this.browserManager.page) {
            this.logger.error("Unable to perform wishlist query: page is undefined!");
            return Promise.resolve({ status: 0, body: null });
        }
        try {
            return await Promise.race([
                this.browserManager.page.evaluate(
                    async (store: Store, pageOffset: number, flowId: string, graphQLClientVersion: string, wishlistSHA256: string) => {
                        const params = new URLSearchParams({
                            operationName: "WishlistItems",
                            variables: JSON.stringify({
                                shouldFetchBasket: true,
                                isArtificialScarcityActive: true,
                                limit: 24,
                                offset: pageOffset,
                                hasMarketplace: true,
                                locale: `${store.languageCode}-${store.countryCode}`,
                                salesLine: store.salesLine,
                                isRefurbishedGoodsActive: true,
                                isPdpFaqSectionActive: true,
                                shouldIncludeYourekoRatingExp1150: true,
                                isDemonstrationModelAvailabilityActive: false,
                                isCrossLinkingActive: false,
                                priceAlertsFilter: [],
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
                                            isEnabled: true,
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
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: wishlistSHA256,
                                },
                                pwa: {
                                    captureChannel: "DESKTOP",
                                    salesLine: store.salesLine,
                                    country: store.countryCode,
                                    language: store.languageCode,
                                    globalLoyaltyProgram: true,
                                    isOneAccountProgramActive: true,
                                    shouldInactiveContractsBeHidden: true,
                                    isUsingXccCustomerComponent: true,
                                    isCheckoutPhoneCompareActive: true,
                                },
                            }),
                        });
                        return fetch(`${store.baseUrl}/api/v1/graphql?${params}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client-pqm",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "WishlistItems",
                                "x-cacheable": "false",
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
                                    .then((data: WishlistResponse) => ({ status: res.status, body: data }))
                                    .catch((_: unknown) => ({
                                        status: res.status,
                                        body: null,
                                        retryAfterHeader: res.headers.get("Retry-After"),
                                    })),
                            )
                            .catch((_: unknown) => ({ status: -2, body: null }));
                    },
                    this.store,
                    offset,
                    randomUUID(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.wishlistSHA256,
                ),
                sleep(this.wishlistRaceTimeout, {
                    status: HTTPStatusCode.Timeout,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (error: unknown) {
            this.logger.error("Unable to perform wishlist query: %O", error);
            return Promise.resolve({ status: HTTPStatusCode.Error, body: null });
        }
    }
}
