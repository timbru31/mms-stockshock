import { v4 } from "uuid";
import type { Logger } from "winston";
import type { BrowserManager } from "../core/browser-manager";
import type { CooldownManager } from "../core/cooldown-manager";
import type { DatabaseConnection } from "../databases/database-connection";
import type { AddProductResponse } from "../models/api/add-product-response";
import type { Product } from "../models/api/product";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import type { Store } from "../models/stores/store";
import { HTTPStatusCode } from "../utils/http";
import { GRAPHQL_CLIENT_VERSION, sleep } from "../utils/utils";

export class BasketAdder {
    private basketProducts = new Map<string, Product>();
    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifiers: Notifier[] = [];
    private readonly browserManager: BrowserManager;
    private readonly cooldownManager: CooldownManager;
    private readonly database: DatabaseConnection | undefined;
    private readonly defaultCookieAmount = 10;
    private readonly oneCookie = 1;
    private readonly addProductRaceTimeout = 2000;

    constructor(
        store: Store,
        storeConfiguration: StoreConfiguration,
        logger: Logger,
        browserManager: BrowserManager,
        cooldownManager: CooldownManager,
        notifiers: Notifier[],
        database: DatabaseConnection | undefined,
    ) {
        this.store = store;
        this.storeConfiguration = storeConfiguration;
        this.logger = logger;
        this.browserManager = browserManager;
        this.cooldownManager = cooldownManager;
        this.notifiers = notifiers;
        this.database = database;
    }

    clearBasketProducts(): void {
        this.basketProducts.clear();
    }

    addNewProducts(newProducts: Map<string, Product>): void {
        this.basketProducts = new Map([...this.basketProducts, ...newProducts]);
    }

    async createBasketCookies(cookieAmount = this.defaultCookieAmount, newSession = true): Promise<void> {
        if (!this.browserManager.page) {
            this.logger.error("Unable to to create cookies: page is undefined!");
            return;
        }

        if (this.basketProducts.size && cookieAmount) {
            if (!newSession) {
                cookieAmount = this.oneCookie;
            }
            for (const [id, product] of this.basketProducts.entries()) {
                const cookies: string[] = [];
                for (let i = 0; i < cookieAmount; i++) {
                    if (newSession) {
                        let freshContextCreated = false;
                        try {
                            freshContextCreated = await this.browserManager.createFreshContext();
                        } catch (e: unknown) {
                            this.logger.error("Context creation failed, error %O", e);
                        }
                        if (!freshContextCreated) {
                            this.logger.error(`Unable to create new context for ${id} try ${i} of ${cookieAmount}. Skipping`);
                            await sleep(this.store.getSleepTime());
                            continue;
                        }
                    }
                    let res: { status: number; success: boolean; body: AddProductResponse | null; retryAfterHeader?: string | null };
                    try {
                        res = await Promise.race([
                            this.browserManager.page.evaluate(
                                async (
                                    store: Store,
                                    productId: string,
                                    flowId: string,
                                    graphQLClientVersion: string,
                                    addProductSHA256: string,
                                ) =>
                                    fetch(`${store.baseUrl}/api/v1/graphql`, {
                                        credentials: "include",
                                        headers: {
                                            /* eslint-disable @typescript-eslint/naming-convention */
                                            "content-type": "application/json",
                                            "apollographql-client-name": "pwa-client",
                                            "apollographql-client-version": graphQLClientVersion,
                                            "x-operation": "AddProduct",
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
                                            operationName: "AddProduct",
                                            variables: {
                                                items: [
                                                    {
                                                        productId,
                                                        outletId: null,
                                                        quantity: 1,
                                                        serviceId: null,
                                                        warrantyId: null,
                                                    },
                                                ],
                                            },
                                            extensions: {
                                                pwa: {
                                                    salesLine: store.salesLine,
                                                    country: store.countryCode,
                                                    language: store.languageCode,
                                                    globalLoyaltyProgram: true,
                                                    fifaUserCreation: true,
                                                },
                                                persistedQuery: {
                                                    version: 1,
                                                    sha256Hash: addProductSHA256,
                                                },
                                            },
                                        }),
                                    })
                                        .then(async (addProductResponse) =>
                                            addProductResponse
                                                .json()
                                                .then((data: AddProductResponse) => ({
                                                    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                                                    success: addProductResponse.status === 200,
                                                    status: addProductResponse.status,
                                                    body: data,
                                                }))
                                                .catch((_) => ({
                                                    success: false,
                                                    status: addProductResponse.status,
                                                    body: null,
                                                    retryAfterHeader: addProductResponse.headers.get("Retry-After"),
                                                })),
                                        )
                                        .catch((_) => ({ success: false, status: -2, body: null })),
                                this.store,
                                id,
                                v4(),
                                GRAPHQL_CLIENT_VERSION,
                                this.storeConfiguration.addProductSHA256,
                            ),
                            sleep(this.addProductRaceTimeout, {
                                success: false,
                                status: HTTPStatusCode.Timeout,
                                body: null,
                            }),
                        ]);
                    } catch (e: unknown) {
                        res = { success: false, status: HTTPStatusCode.Error, body: null };
                        this.logger.error("Error, %O", e);
                    }

                    if (res.success) {
                        try {
                            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                            const basketCookie = (await this.browserManager.page.cookies()).filter((cookie) => cookie.name === "r")[0];
                            if (basketCookie.value) {
                                cookies.push(basketCookie.value);
                                this.logger.info(
                                    `Made cookie ${basketCookie.value} for product ${id}: ${this.store.baseUrl}?cookie=${basketCookie.value}`,
                                );
                            }
                        } catch (e: unknown) {
                            this.logger.error("Unable to get cookie from page, error %O", e);
                        }
                    } else {
                        this.logger.error(`Unable to create cookie for ${id} try ${i} of ${cookieAmount}`);
                    }
                    await sleep(this.store.getSleepTime());
                }
                if (cookies.length) {
                    for (const notifier of this.notifiers) {
                        await notifier.notifyCookies(product, cookies);
                    }
                    this.cooldownManager.addToBasketCooldownMap(product);
                    if (this.database) {
                        await this.database.storeCookies(product, cookies);
                    }
                }
            }
            this.basketProducts.clear();
            this.browserManager.reLoginRequired = true;
        }
    }
}
