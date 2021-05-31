import { SerializableOrJSHandle } from "puppeteer";
import { v4 } from "uuid";
import { Logger } from "winston";
import { BrowserManager } from "./browser-manager";
import { CooldownManager } from "./cooldown-manager";
import { DynamoDBCookieStore } from "./dynamodb-cookie-store";
import { AddProductResponse } from "./models/api/add-product-response";
import { Product } from "./models/api/product";
import { StoreConfiguration } from "./models/stores/config-model";
import { Store } from "./models/stores/store";
import { Notifier } from "./notifier";
import { GRAPHQL_CLIENT_VERSION, sleep } from "./utils";

export class BasketAdder {
    private basketProducts = new Map<string, Product>();
    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifier: Notifier;
    private readonly browserManager: BrowserManager;
    private readonly cooldownManager: CooldownManager;
    private readonly cookieStore: DynamoDBCookieStore | undefined;

    constructor(
        store: Store,
        storeConfiguration: StoreConfiguration,
        logger: Logger,
        browserManager: BrowserManager,
        cooldownManager: CooldownManager,
        notifier: Notifier,
        cookieStore: DynamoDBCookieStore | undefined
    ) {
        this.store = store;
        this.storeConfiguration = storeConfiguration;
        this.logger = logger;
        this.browserManager = browserManager;
        this.cooldownManager = cooldownManager;
        this.notifier = notifier;
        this.cookieStore = cookieStore;
    }

    clearBasketProducts(): void {
        this.basketProducts.clear();
    }

    addNewProducts(newProducts: Map<string, Product>): void {
        this.basketProducts = new Map([...this.basketProducts, ...newProducts]);
    }

    async createBasketCookies(cookieAmount = 10, newSession = true): Promise<void> {
        if (this.basketProducts.size) {
            if (!newSession) {
                cookieAmount = 1;
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for (const [id, product] of this.basketProducts.entries()) {
                const cookies: string[] = [];
                for (let i = 0; i < cookieAmount; i++) {
                    if (newSession) {
                        let contextCreated = false;
                        try {
                            contextCreated = await Promise.race([this.browserManager.createIncognitoContext(false), sleep(6000, false)]);
                        } catch (e) {
                            this.logger.error("Context creation failed, error %O", e);
                        }
                        if (!contextCreated) {
                            this.logger.error(`Unable to create new context for ${id} try ${i} of ${cookieAmount}. Skipping`);
                            await sleep(this.store.getSleepTime());
                            continue;
                        }
                    }
                    let res: { status: number; success: boolean; body: AddProductResponse | null; retryAfterHeader?: string | null };
                    try {
                        res = await Promise.race([
                            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                            this.browserManager.page!.evaluate(
                                async (store: Store, productId: string, flowId: string, graphQLClientVersion, addProductSHA256: string) =>
                                    await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                                        credentials: "include",
                                        headers: {
                                            "content-type": "application/json",
                                            "apollographql-client-name": "pwa-client",
                                            "apollographql-client-version": graphQLClientVersion,
                                            "x-operation": "AddProduct",
                                            "x-cacheable": "false",
                                            "X-MMS-Language": "de",
                                            "X-MMS-Country": store.countryCode,
                                            "X-MMS-Salesline": store.salesLine,
                                            "x-flow-id": flowId,
                                            Pragma: "no-cache",
                                            "Cache-Control": "no-cache",
                                        },
                                        referrer: `${store.baseUrl}/`,
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
                                                    language: "de",
                                                },
                                                persistedQuery: {
                                                    version: 1,
                                                    sha256Hash: addProductSHA256,
                                                },
                                            },
                                        }),
                                        method: "POST",
                                        mode: "cors",
                                    })
                                        .then((res) =>
                                            res
                                                .json()
                                                .then((data) => ({
                                                    success: res.status === 200,
                                                    status: res.status,
                                                    body: data,
                                                }))
                                                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                                .catch((_) => ({
                                                    success: false,
                                                    status: res.status,
                                                    body: null,
                                                    retryAfterHeader: res.headers.get("Retry-After"),
                                                }))
                                        )
                                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                        .catch((_) => ({ success: false, status: -2, body: null })),
                                this.store as SerializableOrJSHandle,
                                id,
                                v4(),
                                GRAPHQL_CLIENT_VERSION,
                                this.storeConfiguration.addProductSHA256
                            ),
                            sleep(2000, {
                                success: false,
                                status: -1,
                                body: null,
                            }),
                        ]);
                    } catch (e) {
                        res = { success: false, status: 0, body: null };
                        this.logger.error("Error, %O", e);
                    }

                    if (res.success) {
                        try {
                            const basketCookie = (await this.browserManager.page?.cookies())?.filter((cookie) => cookie.name === "r")[0];
                            if (basketCookie) {
                                cookies.push(basketCookie.value);
                                this.logger.info(
                                    `Made cookie ${basketCookie.value} for product ${id}: ${this.store.baseUrl}?cookie=${basketCookie.value}`
                                );
                            }
                        } catch (e) {
                            this.logger.error("Unable to get cookie from page, error %O", e);
                        }
                    } else {
                        this.logger.error(`Unable to create cookie for ${id} try ${i} of ${cookieAmount}`);
                    }
                    await sleep(this.store.getSleepTime());
                }
                if (cookies?.length) {
                    await this.notifier.notifyCookies(product, cookies);
                    this.cooldownManager.addToBasketCooldownMap(product);
                    if (this.cookieStore) {
                        this.cookieStore.storeCookies(product, cookies);
                    }
                }
            }
            this.basketProducts.clear();
            this.browserManager.reLoginRequired = true;
        }
    }
}
