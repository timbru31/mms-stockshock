import { SerializableOrJSHandle } from "puppeteer";
import { v4 } from "uuid";
import { Logger } from "winston";
import { BrowserManager } from "./browser-manager";
import { CooldownManager } from "./cooldown-manager";
import { Product } from "./models/api/product";
import { Store } from "./models/stores/store";
import { Notifier } from "./notifier";
import { GRAPHQL_CLIENT_VERSION, sleep } from "./utils";

export class CartAdder {
    private cartProducts = new Map<string, Product>();
    private readonly store: Store;
    private readonly logger: Logger;
    private readonly notifier: Notifier;
    private readonly browserManager: BrowserManager;
    private readonly cooldownManager: CooldownManager;

    constructor(store: Store, logger: Logger, browserManager: BrowserManager, cooldownManager: CooldownManager, notifier: Notifier) {
        this.store = store;
        this.logger = logger;
        this.browserManager = browserManager;
        this.cooldownManager = cooldownManager;
        this.notifier = notifier;
    }

    clearCartProducts(): void {
        this.cartProducts.clear();
    }

    addNewProducts(newProducts: Map<string, Product>): void {
        this.cartProducts = new Map([...this.cartProducts, ...newProducts]);
    }

    async createCartCookies(): Promise<void> {
        if (this.cartProducts.size) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for (const [id, product] of this.cartProducts.entries()) {
                const cookies: string[] = [];
                for (let i = 0; i < 10; i++) {
                    let contextCreated = false;
                    try {
                        contextCreated = await Promise.race([this.browserManager.createIncognitoContext(false), sleep(6000, false)]);
                    } catch (e) {
                        this.logger.error("Context creation failed, error %O", e);
                    }
                    if (!contextCreated) {
                        this.logger.error(`Unable to create new context for ${id} try ${i} of 10. Skipping`);
                        await sleep(this.store.getSleepTime());
                        continue;
                    }
                    let res: { status: number; success: boolean };
                    try {
                        res = await Promise.race([
                            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                            this.browserManager.page!.evaluate(
                                async (store: Store, productId: string, flowId: string, graphQLClientVersion) =>
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
                                                    sha256Hash: "404e7401c3363865cc3d92d5c5454ef7d382128c014c75f5fc39ed7ce549e2b9",
                                                },
                                            },
                                        }),
                                        method: "POST",
                                        mode: "cors",
                                    })
                                        .then((res) => ({ success: res.status === 200, status: res.status }))
                                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                        .catch((_) => ({ success: false, status: -2 })),
                                this.store as SerializableOrJSHandle,
                                id,
                                v4(),
                                GRAPHQL_CLIENT_VERSION
                            ),
                            sleep(2000, {
                                success: false,
                                status: -1,
                            }),
                        ]);
                    } catch (e) {
                        res = { success: false, status: 0 };
                        this.logger.error("Error, %O", e);
                    }

                    if (res.success) {
                        try {
                            const cartCookie = (await this.browserManager.page?.cookies())?.filter((cookie) => cookie.name === "r")[0];
                            if (cartCookie) {
                                cookies.push(cartCookie.value);
                                this.logger.info(
                                    `Made cookie ${cartCookie.value} for product ${id}: ${this.store.baseUrl}?cookie=${cartCookie.value}`
                                );
                            }
                        } catch (e) {
                            this.logger.error("Unable to get cookie from page, error %O", e);
                        }
                    } else {
                        this.logger.error(`Unable to create cookie for ${id} try ${i} of 10`);
                    }
                    await sleep(this.store.getSleepTime());
                }
                if (cookies) {
                    await this.notifier.notifyCookies(product, cookies);
                    this.cooldownManager.addToCartCooldownMap(product);
                }
            }
            this.cartProducts.clear();
            this.browserManager.reLoginRequired = true;
        }
    }
}
