import { prompt } from "inquirer";
import { Server } from "proxy-chain";
import type { Browser, Page, PuppeteerNodeLaunchOptions, SerializableOrJSHandle } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import UserAgent from "user-agents";
import { v4 } from "uuid";
import type { Logger } from "winston";
import type { LoginResponse } from "../models/api/login-response";
import type { Response } from "../models/api/response";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import type { Store } from "../models/stores/store";
import { HTTPStatusCode } from "../utils/http";
import { GRAPHQL_CLIENT_VERSION, shuffle, sleep } from "../utils/utils";

export class BrowserManager {
    reLoginRequired = true;
    reLaunchRequired = false;
    loggedIn = false;
    page: Page | undefined;

    private browser: Browser | undefined;
    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifiers: Notifier[] = [];
    private readonly proxies: string[] = [];
    private readonly defaultProxyIndex = 0;
    private proxyIndex = this.defaultProxyIndex;
    private proxyServer: Server | undefined;
    private readonly launchRaceTimeout = 15000;
    private readonly loginRaceTimeout = 10000;
    private readonly freshContextRaceTimeout = 6000;
    private readonly baseWidth = 1024;
    private readonly baseHeight = 768;
    private readonly randomFactor = 100;

    private readonly millisecondsFactor = 1000;

    constructor(store: Store, storeConfiguration: StoreConfiguration, logger: Logger, notifiers: Notifier[]) {
        this.logger = logger;
        this.store = store;
        this.storeConfiguration = storeConfiguration;
        this.notifiers = notifiers;

        if (this.storeConfiguration.proxy_urls?.length) {
            this.proxies = shuffle(this.storeConfiguration.proxy_urls);
        }

        puppeteer.use(StealthPlugin());
    }

    rotateProxy(): void {
        this.proxyIndex++;
        if (this.proxyIndex >= this.proxies.length) {
            this.proxyIndex = 0;
        }
    }

    async shutdown(): Promise<void> {
        await this.cleanOldReferences();
        await this.proxyServer?.close(true);
    }

    async launchPuppeteer(headless = true, sandbox = true, shmUsage = true): Promise<boolean> {
        return Promise.race([this._launchPuppeteer(headless, sandbox, shmUsage), sleep(this.launchRaceTimeout, false)]);
    }

    async logIn(email: string, password: string, headless = true): Promise<void> {
        if (!this.browser || !this.page) {
            this.reLaunchRequired = true;
            this.reLoginRequired = true;
            throw new Error(`Puppeteer context not initialized! ${!this.page ? "Page" : "Browser"} is undefined.`);
        }

        let res: { status: number; body: LoginResponse | null; retryAfterHeader?: string | null };
        let query = "";
        if (this.storeConfiguration.cache_busting ?? true) {
            query = `anti-cache=${new Date().getTime()}`;
        }
        try {
            res = await Promise.race([
                this.page.evaluate(
                    async (
                        store: Store,
                        // eslint-disable-next-line @typescript-eslint/no-shadow
                        email: string,
                        // eslint-disable-next-line @typescript-eslint/no-shadow
                        password: string,
                        flowId: string,
                        graphQLClientVersion: string,
                        loginSHA256: string,
                        queryString: string
                    ) =>
                        fetch(`${store.baseUrl}/api/v1/graphql?${queryString}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "LoginProfileUser",
                                "x-cacheable": "false",
                                "x-mms-language": store.languageCode,
                                "x-mms-country": store.countryCode,
                                "x-mms-salesline": store.salesLine,
                                "x-flow-id": flowId,
                                /* eslint-disable @typescript-eslint/naming-convention */
                                Pragma: "no-cache",
                                "Cache-Control": "no-cache",
                                /* eslint-enable @typescript-eslint/naming-convention */
                            },
                            referrer: `${store.baseUrl}/`,
                            method: "POST",
                            mode: "cors",
                            body: JSON.stringify({
                                operationName: "LoginProfileUser",
                                variables: { email, password },
                                extensions: {
                                    pwa: { salesLine: store.salesLine, country: store.countryCode, language: store.languageCode },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: loginSHA256,
                                    },
                                },
                            }),
                        })
                            .then(async (loginResponse) =>
                                loginResponse
                                    .json()
                                    .then((data: LoginResponse) => ({ status: loginResponse.status, body: data }))
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    .catch((_) => ({
                                        status: loginResponse.status,
                                        body: null,
                                        retryAfterHeader: loginResponse.headers.get("Retry-After"),
                                    }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -2, body: null })),
                    this.store as SerializableOrJSHandle,
                    email,
                    password,
                    v4(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfiguration.loginSHA256,
                    query
                ),
                sleep(this.loginRaceTimeout, {
                    status: HTTPStatusCode.Timeout,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (e: unknown) {
            res = { status: HTTPStatusCode.Error, body: null };
            this.logger.error("Error, %O", e);
        }
        if (res.status !== HTTPStatusCode.OK || !res.body || res.body.errors) {
            if (headless) {
                await this.handleResponseError("Login", res);
                for (const notifier of this.notifiers) {
                    await notifier.notifyAdmin(`😵 Login did not succeed. Status ${res.status}`);
                }
                this.loggedIn = false;
                this.reLoginRequired = true;
                throw new Error(`Login did not succeed. Status ${res.status}`);
            }
            await prompt({
                name: "noop",
                message: "Login did not succeed, please check browser for captcha and log in manually. Then hit enter...",
            });
        }
        this.loggedIn = true;
        this.reLoginRequired = false;
    }

    async createFreshContext(): Promise<boolean> {
        return Promise.race([this._createFreshContext(), sleep(this.freshContextRaceTimeout, false)]);
    }

    async handleResponseError(
        query: string,
        res: { status: number; body: Response | null; retryAfterHeader?: string | null }
    ): Promise<void> {
        this.logger.error(`${query} query did not succeed, status code: ${res.status}`);
        if (res.body?.errors) {
            this.logger.error("Error: %O", res.body.errors);
        }
        if (
            res.status <= HTTPStatusCode.Timeout ||
            res.status === HTTPStatusCode.Forbidden ||
            res.status === HTTPStatusCode.TooManyRequests
        ) {
            if (this.proxies.length) {
                this.rotateProxy();
                this.reLoginRequired = true;
            }
            if (!this.storeConfiguration.ignore_sleep && res.retryAfterHeader) {
                let cooldown = Number(res.retryAfterHeader);
                this.logger.error(`Too many requests, we need to cooldown and sleep ${cooldown} seconds`);
                for (const notifier of this.notifiers) {
                    await notifier.notifyRateLimit(cooldown);
                }
                const fiveMinutes = 300;
                const fiveMinutesWithBuffer = 320;
                if (cooldown > fiveMinutes) {
                    this.reLoginRequired = true;
                    cooldown = fiveMinutesWithBuffer;
                }
                await sleep(cooldown * this.millisecondsFactor);
            } else {
                this.reLoginRequired = true;
                this.reLaunchRequired = true;
            }
        }
    }

    private async _launchPuppeteer(headless: boolean, sandbox: boolean, shmUsage: boolean) {
        await this.cleanOldReferences();

        const args = [];
        if (!sandbox) {
            args.push("--no-sandbox");
        }

        if (!shmUsage) {
            args.push("--disable-dev-shm-usage");
        }

        if (this.storeConfiguration.proxy_urls?.length) {
            if (!this.proxyServer) {
                this.proxyServer = new Server({
                    port: 0,
                    prepareRequestFunction: () => {
                        this.logger.info("Using proxy %O", this.proxies[this.proxyIndex]);
                        return {
                            requestAuthentication: false,
                            upstreamProxyUrl: this.proxies[this.proxyIndex],
                        };
                    },
                });
                await this.proxyServer.listen();
            }
            args.push(`--proxy-server=http://127.0.0.1:${this.proxyServer.port}`);
        } else if (this.storeConfiguration.proxy_url) {
            args.push(`--proxy-server=${this.storeConfiguration.proxy_url}`);
        }

        this.browser = await puppeteer.launch({
            headless,
            defaultViewport: null,
            args,
        } as unknown as PuppeteerNodeLaunchOptions);
        this.reLaunchRequired = false;
        return Boolean(this.browser);
    }

    private async _createFreshContext() {
        if (!this.browser) {
            this.logger.error("Unable to create fresh context, browser is undefined!");
            return false;
        }

        if (this.page) {
            await this.page.close();
            this.page = undefined;
        }
        this.page = await this.browser.newPage();
        await this.page.setUserAgent(new UserAgent().toString());
        await this.patchHairlineDetection();

        if (this.storeConfiguration.proxy_url && this.storeConfiguration.proxy_username && this.storeConfiguration.proxy_password) {
            await this.page.authenticate({
                username: this.storeConfiguration.proxy_username,
                password: this.storeConfiguration.proxy_password,
            });
        }

        const client = await this.page.target().createCDPSession();
        await client.send("Network.clearBrowserCookies");

        // This is the fastest site to render without any JS or CSS bloat
        await this.page.setJavaScriptEnabled(false);
        await this.page.setViewport({
            width: this.baseWidth + Math.floor(Math.random() * this.randomFactor),
            height: this.baseHeight + Math.floor(Math.random() * this.randomFactor),
        });
        try {
            await this.page.goto(this.storeConfiguration.start_url ?? `${this.store.baseUrl}/404`, {
                waitUntil: "networkidle0",
                timeout: 5000,
            });
        } catch (e: unknown) {
            this.logger.error("Unable to visit start page..., %O", e);
            this.rotateProxy();
            return false;
        }

        if (this.store.loginSleepTime) {
            await sleep(this.store.loginSleepTime);
        }
        return Boolean(this.page);
    }

    // See https://intoli.com/blog/making-chrome-headless-undetectable/
    private async patchHairlineDetection() {
        try {
            await this.page?.evaluateOnNewDocument(() => {
                // store the existing descriptor
                const elementDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

                // redefine the property with a patched descriptor
                Object.defineProperty(HTMLDivElement.prototype, "offsetHeight", {
                    ...elementDescriptor,
                    get: function () {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                        if (this.id === "modernizr") {
                            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                            return 1;
                        }
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                        return elementDescriptor?.get?.apply(this);
                    },
                });
            });
        } catch (e: unknown) {
            this.logger.error("Unable to patch hairline detection, error %O", e);
        }
    }

    private async cleanOldReferences() {
        if (this.page) {
            try {
                await this.page.close();
            } catch (e: unknown) {
                this.logger.error("Unable to close page, %O", e);
            } finally {
                this.page = undefined;
            }
        }
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e: unknown) {
                this.logger.error("Unable to close browser, %O", e);
            } finally {
                this.browser = undefined;
            }
        }
    }
}
