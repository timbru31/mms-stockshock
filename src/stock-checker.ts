import { IncomingWebhook } from "@slack/webhook";
import { prompt } from "inquirer";
import { launch, Page } from "puppeteer";

import { Item } from "./models/api/item";
import { WishlistReponse } from "./models/api/wishlist-response";
import { Store } from "./models/stores/store";

export class StockChecker {
    MAX_ITEMS_PER_QUERY = 24;
    private loggedIn = false;
    private readonly store: Store;
    private page: Page | undefined;
    private readonly webhook: IncomingWebhook | undefined;

    constructor(store: Store, webhookUrl?: string) {
        if (webhookUrl) {
            this.webhook = new IncomingWebhook(webhookUrl);
        }
        this.store = store;
    }

    async logIn(email: string, password: string): Promise<void> {
        if (this.loggedIn) {
            throw new Error("Already logged in");
        }

        const browser = await launch({ headless: false });
        this.page = await browser.newPage();
        // This is the fastest site to render without any JS bloat
        await this.page.goto(`${this.store.baseUrl}/404`, {
            waitUntil: "networkidle0",
        });
        const res = await this.page.evaluate(
            async (store: Store, email: string, password: string) =>
                await fetch(`${store.baseUrl}/api/v1/graphql`, {
                    credentials: "include",
                    headers: {
                        "content-type": "application/json",
                        "apollographql-client-name": "pwa-client",
                        "apollographql-client-version": "7.6.0",
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
                            persistedQuery: { version: 1, sha256Hash: "cfd846cd502b48472f1c55a2887c8055ee41d2e2e4b179a1e718813ba7d832a0" },
                        },
                    }),
                    method: "POST",
                    mode: "cors",
                }).then((res) => res.json().then((data) => ({ status: res.status, body: data }))),
            this.store,
            email,
            password
        );
        if (res.status !== 200 || res.body?.errors) {
            await prompt({
                name: "noop",
                message: "Login did not succeed, please check browser for captcha and log in manually. Then hit enter...",
            });
        }
        this.loggedIn = true;
    }

    async checkStock(): Promise<void> {
        if (!this.loggedIn) {
            throw new Error("Not logged in!");
        }

        const response = await this.performWhishlistQuery();
        if (response.status !== 200 || response.body?.errors) {
            console.error("Whistlist query did not succeed, status code:", response.status, response.body?.errors);
        } else {
            const totalItems = response.body?.data?.wishlistItems?.total;
            this.checkItems(response.body?.data?.wishlistItems?.items);

            if (totalItems > this.MAX_ITEMS_PER_QUERY) {
                const remainingQueryCalls = Math.ceil((totalItems - this.MAX_ITEMS_PER_QUERY) / this.MAX_ITEMS_PER_QUERY);
                for (let additionalQueryCalls = 1; additionalQueryCalls <= remainingQueryCalls; additionalQueryCalls += 1) {
                    const newOffset = additionalQueryCalls * this.MAX_ITEMS_PER_QUERY;
                    const response = await this.performWhishlistQuery(newOffset);
                    if (response.status !== 200) {
                        console.error("Whistlist query did not succeed, status code:", response.status);
                    } else {
                        this.checkItems(response.body?.data?.wishlistItems?.items);
                    }
                }
            }
        }
    }

    private async performWhishlistQuery(
        offset = 0
    ): Promise<{
        status: number;
        body: WishlistReponse;
    }> {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return await this.page!.evaluate(
            async (store: Store, offset: number) =>
                await fetch(`${store.baseUrl}/api/v1/graphql`, {
                    credentials: "include",
                    headers: {
                        "content-type": "application/json",
                        "apollographql-client-name": "pwa-client",
                        "apollographql-client-version": "7.6.0",
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
                }).then((res) => res.json().then((data) => ({ status: res.status, body: data }))),
            this.store,
            offset
        );
    }

    private checkItems(items: Item[]): void {
        if (items) {
            for (const item of items) {
                if (item?.product?.onlineStatus || item?.availability.delivery.availabilityType !== "NONE") {
                    this.notify(item);
                }
            }
        }
    }

    private notify(item: Item) {
        const message = `Item available ${item.product.title} for ${item.price.price} ${item.price.currency}! Go check it out: ${this.store.baseUrl}${item.product.url}`;
        if (this.webhook) {
            this.webhook.send({
                text: message,
                username: "Stock Shock ⚡️",
                attachments: [
                    {
                        title_link: `${this.store.baseUrl}${item.product.url}`,
                        image_url: `https://assets.mmsrg.com/isr/166325/c1/-/${item.product.titleImageId}/mobile_200_200.png`,
                    },
                ],
            });
        }
        console.log(message);
        this.beep();
        setTimeout(() => this.beep(), 250);
        setTimeout(() => this.beep(), 500);
    }

    private beep() {
        process.stdout.write("\x07");
    }
}
