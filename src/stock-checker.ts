import { IncomingWebhook } from "@slack/webhook";
import add from "date-fns/add";
import { prompt } from "inquirer";
import { Browser, BrowserContext, Page, PuppeteerNodeLaunchOptions, SerializableOrJSHandle } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import UserAgent from "user-agents";
import { Logger } from "winston";

import { Item } from "./models/api/item";
import { WishlistReponse } from "./models/api/wishlist-response";
import { NotificationCooldown } from "./models/cooldown";
import { StoreConfiguration } from "./models/stores/config-model";
import { Store } from "./models/stores/store";

export class StockChecker {
    // This is set by MM/S and a fixed constant
    readonly MAX_ITEMS_PER_QUERY = 24;
    readonly cartItems = new Map<string, Item>();
    reLoginRequired = false;

    private loggedIn = false;
    private usesProxy = false;
    private readonly store: Store;
    private browser: Browser | undefined;
    private context: BrowserContext | undefined;
    private page: Page | undefined;
    private readonly webhook: IncomingWebhook | undefined;
    private readonly webhookRolePing: string | undefined;
    private readonly logger: Logger;
    private readonly cooldowns = new Map<string, NotificationCooldown>();
    private readonly cartCooldowns = new Map<string, NotificationCooldown>();

    constructor(store: Store, logger: Logger, storeConfig: StoreConfiguration) {
        if (storeConfig?.webhook_url) {
            this.webhook = new IncomingWebhook(storeConfig.webhook_url);
        }
        if (storeConfig?.webhook_role_ping) {
            this.webhookRolePing = storeConfig.webhook_role_ping;
        }
        this.store = store;
        this.logger = logger;
    }

    async launchPuppeteer(storeConfig: StoreConfiguration, headless = true, sandbox = true): Promise<void> {
        const args = [];
        if (!sandbox) {
            args.push("--no-sandbox");
        }

        if (storeConfig.proxy_url) {
            args.push(`--proxy-server=${storeConfig.proxy_url}`);
            this.usesProxy = true;
        }

        this.browser = await puppeteer.launch(({
            headless,
            defaultViewport: null,
            args,
        } as unknown) as PuppeteerNodeLaunchOptions);
    }

    async logIn(storeConfig: StoreConfiguration, headless = true): Promise<void> {
        if (!this.browser) {
            throw new Error("Puppeteer context not inialized!");
        }

        await this.createIncognitoContext(storeConfig);

        const res = await Promise.race([
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.page!.evaluate(
                async (store: Store, email: string, password: string) =>
                    await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                        credentials: "include",
                        headers: {
                            "content-type": "application/json",
                            "apollographql-client-name": "pwa-client",
                            "apollographql-client-version": "7.9.0",
                            "x-operation": "LoginProfileUser",
                            "x-cacheable": "false",
                            "X-MMS-Language": "de",
                            "X-MMS-Country": store.countryCode,
                            "X-MMS-Salesline": store.salesLine,
                            Pragma: "no-cache",
                            "Cache-Control": "no-cache",
                        },
                        referrer: `${store.baseUrl}/`,
                        body: JSON.stringify({
                            operationName: "LoginProfileUser",
                            variables: { email, password },
                            extensions: {
                                pwa: { salesLine: store.salesLine, country: store.countryCode, language: "de" },
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: "cfd846cd502b48472f1c55a2887c8055ee41d2e2e4b179a1e718813ba7d832a0",
                                },
                            },
                        }),
                        method: "POST",
                        mode: "cors",
                    }).then((res) =>
                        res.status === 200
                            ? res
                                  .json()
                                  .then((data) => ({ status: res.status, body: data }))
                                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                  .catch((_) => ({ status: res.status, body: null, retryAfter: res.headers.get("Retry-After") }))
                            : res.text().then((data) => ({ status: res.status, body: data }))
                    ),
                this.store as SerializableOrJSHandle,
                storeConfig.email,
                storeConfig.password
            ),
            this.sleep(5000, {
                status: 0,
                body: { errors: "Timeout" },
            }),
        ]);
        if (res.status !== 200 || !res.body || res.body?.errors) {
            if (headless) {
                this.logger.error(`Login did not succeed, please restart with '--no-headless' option, Status ${res.status}`);
                process.exit(1);
            }
            await prompt({
                name: "noop",
                message: "Login did not succeed, please check browser for captcha and log in manually. Then hit enter...",
            });
        }
        this.loggedIn = true;
        this.reLoginRequired = false;
    }

    private async createIncognitoContext(storeConfig: StoreConfiguration, exitOnFail = true) {
        if (this.context) {
            this.context.close();
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.context = await this.browser!.createIncognitoBrowserContext();
        puppeteer.use(StealthPlugin());

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.page = await this.browser!.newPage();
        this.page.setUserAgent(new UserAgent().toString());
        await this.patchHairlineDetection();

        if (storeConfig.proxy_url && storeConfig.proxy_username && storeConfig.proxy_password) {
            await this.page.authenticate({ username: storeConfig.proxy_username, password: storeConfig.proxy_password });
        }

        const client = await this.page.target().createCDPSession();
        await client.send("Network.clearBrowserCookies");

        // This is the fastest site to render without any JS or CSS bloat
        await this.page.setJavaScriptEnabled(false);
        try {
            await this.page.goto(storeConfig.start_url || `${this.store.baseUrl}/404`, {
                waitUntil: "networkidle0",
                timeout: 5000,
            });
        } catch (e) {
            this.logger.error("Unable to visit start page...");
            if (exitOnFail) {
                process.exit(1);
            }
            return false;
        }

        if (this.store.loginSleepTime) {
            await this.sleep(this.store.loginSleepTime);
        }
        return true;
    }

    async checkStock(): Promise<void> {
        if (!this.loggedIn) {
            throw new Error("Not logged in!");
        }

        const res = await this.performWishlistQuery();
        if (res.status !== 200 || !res.body || res.body?.errors) {
            await this.handleWishlistError(res);
        } else {
            const totalItems = res.body?.data?.wishlistItems?.total;
            if (!totalItems) {
                throw new Error("Nothing on wishlist!");
            }
            this.checkItems(res.body?.data?.wishlistItems?.items);

            if (totalItems > this.MAX_ITEMS_PER_QUERY) {
                const remainingQueryCalls = Math.ceil((totalItems - this.MAX_ITEMS_PER_QUERY) / this.MAX_ITEMS_PER_QUERY);
                for (let additionalQueryCalls = 1; additionalQueryCalls <= remainingQueryCalls; additionalQueryCalls += 1) {
                    await this.sleep();
                    const newOffset = additionalQueryCalls * this.MAX_ITEMS_PER_QUERY;
                    const res = await this.performWishlistQuery(newOffset);
                    if (res.status !== 200 || !res.body || res.body?.errors) {
                        await this.handleWishlistError(res);
                    } else {
                        this.checkItems(res.body?.data?.wishlistItems?.items);
                    }
                }
            }
        }
    }

    async createCartCookies(storeConfig: StoreConfiguration): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for (const [id, item] of this.cartItems.entries()) {
            const cookies: string[] = [];
            for (let i = 0; i < 10; i++) {
                const contextCreated = await Promise.race([this.createIncognitoContext(storeConfig, false), this.sleep(6000, false)]);
                if (!contextCreated) {
                    this.logger.error(`Unable to create new context for ${id} try ${i} of 10. Skipping`);
                    await this.sleep();
                    continue;
                }
                const res: { status: number; success: boolean } = await Promise.race([
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    this.page!.evaluate(
                        async (store: Store, productId: string) =>
                            await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                                credentials: "include",
                                headers: {
                                    "content-type": "application/json",
                                    "apollographql-client-name": "pwa-client",
                                    "apollographql-client-version": "7.9.0",
                                    "x-operation": "AddProduct",
                                    "x-cacheable": "false",
                                    "X-MMS-Language": "de",
                                    "X-MMS-Country": store.countryCode,
                                    "X-MMS-Salesline": store.salesLine,
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
                                .catch((_) => ({ success: false, status: -1 })),
                        this.store as SerializableOrJSHandle,
                        id
                    ),
                    this.sleep(2000, {
                        success: false,
                        status: 0,
                    }),
                ]);
                if (res.success) {
                    const cartCookie = (await this.page?.cookies())?.filter((cookie) => cookie.name === "r")[0];
                    if (cartCookie) {
                        cookies.push(cartCookie.value);
                        this.logger.info(`Made cookie ${cartCookie.value} for product ${id}`);
                    }
                } else {
                    this.logger.error(`Unable to create cookie for ${id} try ${i} of 10`);
                }
                await this.sleep();
            }
            if (cookies) {
                this.notifyCookies(item, cookies);
            }
        }
        this.reLoginRequired = true;
    }

    cleanupCooldowns(): void {
        const now = new Date();
        for (const [id, cooldown] of this.cooldowns) {
            if (now > cooldown.endTime) {
                this.cooldowns.delete(id);
            }
        }

        for (const [id, cooldown] of this.cartCooldowns) {
            if (now > cooldown.endTime) {
                this.cartCooldowns.delete(id);
            }
        }
    }

    // See https://intoli.com/blog/making-chrome-headless-undetectable/
    private async patchHairlineDetection() {
        await this.page?.evaluateOnNewDocument(() => {
            // store the existing descriptor
            const elementDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

            // redefine the property with a patched descriptor
            Object.defineProperty(HTMLDivElement.prototype, "offsetHeight", {
                ...elementDescriptor,
                get: function () {
                    if (this.id === "modernizr") {
                        return 1;
                    }
                    return elementDescriptor?.get?.apply(this);
                },
            });
        });
    }

    private async handleWishlistError(res: { status: number; body: WishlistReponse | null; retryAfterHeader: string | null }) {
        this.logger.error(`Wishlist query did not succeed, status code: ${res.status}`);
        if (res.body?.errors) {
            this.logger.error("Error: %O", res.body.errors);
        }
        if (res.status === 429 && res?.retryAfterHeader) {
            let cooldown = Number(res.retryAfterHeader);
            this.logger.error(`Too many requests, we need to cooldown and sleep ${cooldown} seconds`);
            this.notifyRateLimit(cooldown);
            if (cooldown > 300) {
                this.reLoginRequired = true;
                cooldown = 320;
            }
            await this.sleep(cooldown * 1000);
        }

        if (res.status === 403 || res.status === 0) {
            this.reLoginRequired = true;
        }
    }

    private async sleep<T>(sleepTime?: number, returnValue?: T) {
        let randomSleepTime: number;
        if (!sleepTime) {
            randomSleepTime = this.store.getSleepTime();
        }
        return new Promise<T>((resolve) => setTimeout(() => resolve(returnValue || ({} as T)), sleepTime || randomSleepTime));
    }

    private async performWishlistQuery(
        offset = 0
    ): Promise<{
        status: number;
        body: WishlistReponse | null;
        retryAfterHeader: string | null;
    }> {
        return await Promise.race([
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.page!.evaluate(
                async (store: Store, offset: number) =>
                    await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                        credentials: "include",
                        headers: {
                            "content-type": "application/json",
                            "apollographql-client-name": "pwa-client",
                            "apollographql-client-version": "7.9.0",
                            "x-operation": "GetUser",
                            "x-cacheable": "false",
                            "X-MMS-Language": "de",
                            "X-MMS-Country": store.countryCode,
                            "X-MMS-Salesline": store.salesLine,
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
                                    sha256Hash: "34f689a65435266a00785158604c61a7ad262c5a5bac523dd1af68c406f72248",
                                },
                            },
                        }),
                        mode: "cors",
                    }).then((res) =>
                        res
                            .json()
                            .then((data) => ({ status: res.status, body: data, retryAfterHeader: null }))
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: res.status, body: null, retryAfterHeader: res.headers.get("Retry-After") }))
                    ),
                this.store as SerializableOrJSHandle,
                offset
            ),
            this.sleep(5000, {
                status: 0,
                retryAfterHeader: null,
                body: { errors: "Timeout" },
            }),
        ]);
    }

    private checkItems(items: Item[] | undefined): void {
        if (items) {
            for (const item of items) {
                if (!item) {
                    continue;
                }

                if (this.isProductAvailable(item)) {
                    const itemId = item?.product?.id;
                    if (!itemId) {
                        continue;
                    }
                    const isProductBuyable = this.isProductBuyable(item);

                    // Delete the cooldown in case the stock changes to really available
                    if (!this.cooldowns.get(itemId)?.isProductBuyable && isProductBuyable) {
                        this.cooldowns.delete(itemId);
                    }

                    if (!this.cooldowns.has(itemId)) {
                        this.notifyStock(item);
                    }

                    if (this.canProductBeAddedToCart(item) && !this.cartCooldowns.has(itemId)) {
                        this.cartItems.set(itemId, item);
                    }
                }
            }
        }
    }

    /*
     * Check if an item can be added to cart (onlineStatus) - this overrules everything
     * Otherwise check if the item is listed as IN_WAREHOUSE or LONG_TAIL with at least a quantity > 0
     * There seems to be IN_STORE too, where the quantity does not matter. Probably a local store will ship the item
     * Special note: LONG_TAIL needs to be purchsable (onlineStatus)!
     */
    private isProductAvailable(item: Item) {
        if (item?.product?.onlineStatus) {
            return true;
        }

        switch (item?.availability?.delivery?.availabilityType) {
            case "IN_STORE":
                return true;
            case "IN_WAREHOUSE":
                return item?.availability?.delivery?.quantity > 0;
            case "LONG_TAIL":
                return item?.product.onlineStatus && item?.availability?.delivery?.quantity > 0;
        }
        return false;
    }

    private isProductBuyable(item: Item) {
        if (item?.product?.onlineStatus) {
            switch (item?.availability?.delivery?.availabilityType) {
                case "IN_STORE":
                    return true;
                case "IN_WAREHOUSE":
                case "LONG_TAIL":
                    return item?.availability?.delivery?.quantity > 0;
            }
        }
        return false;
    }

    private canProductBeAddedToCart(item: Item) {
        return item?.product?.onlineStatus;
    }

    private notifyStock(item: Item) {
        let message;
        const fullAlert = this.isProductBuyable(item);
        if (fullAlert) {
            message = this.decorateMessageWithRoles(
                `🟢 Item **available**: ${item?.product?.title} for ${item?.price?.price} ${item?.price?.currency}! Go check it out: ${this.store.baseUrl}${item?.product?.url}`
            );
        } else if (this.canProductBeAddedToCart(item)) {
            message = this.decorateMessageWithRoles(
                `🛒 Item **can be added to cart**: ${item?.product?.title} for ${item?.price?.price} ${item?.price?.currency}! Go check it out: ${this.store.baseUrl}${item?.product?.url}?magician=${item?.product?.id}`
            );
        } else {
            message = this.decorateMessageWithRoles(
                `🟡 Item for **cart parker**: ${item?.product?.title} for ${item?.price?.price} ${item?.price?.currency}! Go check it out: ${this.store.baseUrl}${item?.product?.url}`
            );
        }
        if (this.webhook) {
            this.webhook.send({
                text: message,
                username: `Stock Shock ${fullAlert ? "🧚" : "⚡️"}`,
                attachments: [
                    {
                        title_link: `${this.store.baseUrl}${item.product.url}`,
                        image_url: `https://assets.mmsrg.com/isr/166325/c1/-/${item.product.titleImageId}/mobile_200_200.png`,
                    },
                ],
            });
        }
        this.logger.info(message);
        if (fullAlert) {
            this.beep();
            setTimeout(() => this.beep(), 250);
            setTimeout(() => this.beep(), 500);
        }
        this.addToCooldownMap(fullAlert, item);
    }

    private notifyCookies(item: Item, cookies: string[]) {
        const message = this.decorateMessageWithRoles(
            `🍪: ${cookies.length} cart cookies were made for ${item?.product?.title}:\n\`${cookies.join("\n")}\``
        );
        if (this.webhook) {
            this.webhook.send({
                text: message,
                username: "Stock Shock 🍪",
                attachments: [
                    {
                        title_link: `${this.store.baseUrl}${item.product.url}`,
                        image_url: `https://assets.mmsrg.com/isr/166325/c1/-/${item.product.titleImageId}/mobile_200_200.png`,
                    },
                ],
            });
        }

        this.addToCartCooldownMap(item);
    }

    private addToCooldownMap(isProductBuyable: boolean, item: Item) {
        const endTime = add(new Date(), {
            minutes: isProductBuyable ? 1 : 5,
        });
        this.cooldowns.set(item?.product?.id, {
            id: item?.product?.id,
            isProductBuyable,
            endTime,
        });
    }

    private addToCartCooldownMap(item: Item) {
        const endTime = add(new Date(), {
            hours: 4,
        });
        this.cartCooldowns.set(item?.product?.id, {
            id: item?.product?.id,
            isProductBuyable: null,
            endTime,
        });
    }

    private beep() {
        process.stdout.write("\x07");
    }

    private notifyRateLimit(seconds: number) {
        if (this.webhook && seconds > 300 && !this.usesProxy) {
            const message = `[${this.store.salesLine}] Too many requests, we need to pause ${(seconds / 60).toFixed(2)} minutes... 😴`;
            this.webhook.send({
                text: message,
                username: `Stock Shock 💤`,
            });
        }
    }

    private decorateMessageWithRoles(message: string) {
        if (!this.webhookRolePing) {
            return message;
        }

        return `${message} <@&${this.webhookRolePing}>`;
    }
}
