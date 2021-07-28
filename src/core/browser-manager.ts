import { prompt } from "inquirer";
import { Server } from "proxy-chain";
import { Browser, BrowserContext, Page, PuppeteerNodeLaunchOptions, SerializableOrJSHandle } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import UserAgent from "user-agents";
import { v4 } from "uuid";
import { Logger } from "winston";
import { LoginResponse } from "../models/api/login-response";
import { Response } from "../models/api/response";
import { Notifier } from "../models/notifier";
import { StoreConfiguration } from "../models/stores/config-model";
import { Store } from "../models/stores/store";
import { GRAPHQL_CLIENT_VERSION, shuffle, sleep } from "../utils/utils";

export class BrowserManager {
    reLoginRequired = true;
    reLaunchRequired = false;
    loggedIn = false;
    page: Page | undefined;

    private browser: Browser | undefined;
    private context: BrowserContext | undefined;
    private readonly store: Store;
    private readonly storeConfig: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifiers: Notifier[] = [];
    private readonly proxies: string[] = [];
    private proxyIndex = 0;
    private proxyServer: Server | undefined;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger, notifiers: Notifier[]) {
        this.logger = logger;
        this.store = store;
        this.storeConfig = storeConfig;
        this.notifiers = notifiers;

        if (this.storeConfig.proxy_urls?.length) {
            this.proxies = shuffle(this.storeConfig.proxy_urls);
        }
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

    async launchPuppeteer(headless = true, sandbox = true, shmUsage = true): Promise<void> {
        await this.cleanOldReferences();

        const args = [];
        if (!sandbox) {
            args.push("--no-sandbox");
        }

        if (!shmUsage) {
            args.push("--disable-dev-shm-usage");
        }

        if (this.storeConfig.proxy_urls?.length) {
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
        } else if (this.storeConfig.proxy_url) {
            args.push(`--proxy-server=${this.storeConfig.proxy_url}`);
        }

        this.browser = await puppeteer.launch({
            headless,
            defaultViewport: null,
            args,
        } as unknown as PuppeteerNodeLaunchOptions);
        this.reLaunchRequired = false;
    }

    async logIn(headless = true, email: string, password: string): Promise<void> {
        if (!this.browser || !this.page) {
            this.reLaunchRequired = true;
            this.reLoginRequired = true;
            throw new Error(`Puppeteer context not initialized! ${!this.page ? "Page" : "Browser"} is undefined.`);
        }

        let res: { status: number; body: LoginResponse | null; retryAfterHeader?: string | null };
        try {
            res = await Promise.race([
                this.page.evaluate(
                    async (
                        store: Store,
                        email: string,
                        password: string,
                        flowId: string,
                        graphQLClientVersion: string,
                        loginSHA256: string
                    ) =>
                        await fetch(`${store.baseUrl}/api/v1/graphql?anti-cache=${new Date().getTime()}`, {
                            credentials: "include",
                            headers: {
                                "content-type": "application/json",
                                "apollographql-client-name": "pwa-client",
                                "apollographql-client-version": graphQLClientVersion,
                                "x-operation": "LoginProfileUser",
                                "x-cacheable": "false",
                                "X-MMS-Language": "de",
                                "X-MMS-Country": store.countryCode,
                                "X-MMS-Salesline": store.salesLine,
                                "x-flow-id": flowId,
                                Pragma: "no-cache",
                                "Cache-Control": "no-cache",
                            },
                            referrer: `${store.baseUrl}/`,
                            method: "POST",
                            mode: "cors",
                            body: JSON.stringify({
                                operationName: "LoginProfileUser",
                                variables: { email, password },
                                extensions: {
                                    pwa: { salesLine: store.salesLine, country: store.countryCode, language: "de" },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: loginSHA256,
                                    },
                                },
                            }),
                        })
                            .then((res) =>
                                res.status === 200
                                    ? res
                                          .json()
                                          .then((data) => ({ status: res.status, body: data }))
                                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                          .catch((_) => ({
                                              status: res.status,
                                              body: null,
                                              retryAfterHeader: res.headers.get("Retry-After"),
                                          }))
                                    : res.text().then((data) => ({
                                          status: res.status,
                                          body: data,
                                          retryAfterHeader: res.headers.get("Retry-After"),
                                      }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -2, body: null })),
                    this.store as SerializableOrJSHandle,
                    email,
                    password,
                    v4(),
                    GRAPHQL_CLIENT_VERSION,
                    this.storeConfig.loginSHA256
                ),
                sleep(10000, {
                    status: -1,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (e) {
            res = { status: 0, body: null };
            this.logger.error("Error, %O", e);
        }
        if (res.status !== 200 || !res.body || res.body?.errors) {
            if (headless) {
                this.logger.error(`Login did not succeed. Status ${res.status}`);
                if (res.body?.errors) {
                    this.logger.error("Errors: %O", res.body);
                }
                if (res.retryAfterHeader) {
                    this.logger.error("Retry after: %O", res.retryAfterHeader);
                }
                for (const notifier of this.notifiers) {
                    await notifier.notifyAdmin(`😵 [${this.store.getName()}] Login did not succeed. Status ${res.status}`);
                }
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

    async createIncognitoContext(): Promise<boolean> {
        return Promise.race([this._createIncognitoContext(), sleep(6000, false)]);
    }

    private async _createIncognitoContext() {
        if (!this.browser) {
            this.logger.error("Unable to create incognito context, browser is undefined!");
            return false;
        }

        if (this.context) {
            await this.context.close();
            this.context = undefined;
        }

        this.context = await this.browser.createIncognitoBrowserContext();
        puppeteer.use(StealthPlugin());

        if (this.page) {
            await this.page.close();
            this.page = undefined;
        }
        this.page = await this.browser.newPage();
        await this.page.setUserAgent(new UserAgent().toString());
        await this.patchHairlineDetection();

        if (this.storeConfig.proxy_url && this.storeConfig.proxy_username && this.storeConfig.proxy_password) {
            await this.page.authenticate({ username: this.storeConfig.proxy_username, password: this.storeConfig.proxy_password });
        }

        const client = await this.page.target().createCDPSession();
        await client.send("Network.clearBrowserCookies");

        // This is the fastest site to render without any JS or CSS bloat
        await this.page.setJavaScriptEnabled(false);
        await this.page.setViewport({
            width: 1024 + Math.floor(Math.random() * 100),
            height: 768 + Math.floor(Math.random() * 100),
        });
        try {
            await this.page.goto(this.storeConfig.start_url || `${this.store.baseUrl}/404`, {
                waitUntil: "networkidle0",
                timeout: 5000,
            });
        } catch (e) {
            this.logger.error("Unable to visit start page...");
            this.rotateProxy();
            return false;
        }

        if (this.store.loginSleepTime) {
            await sleep(this.store.loginSleepTime);
        }
        return true;
    }

    async handleResponseError(
        query: string,
        res: { status: number; body: Response | null; retryAfterHeader?: string | null }
    ): Promise<void> {
        this.logger.error(`${query} query did not succeed, status code: ${res.status}`);
        if (res?.body?.errors) {
            this.logger.error("Error: %O", res.body.errors);
        }
        if (res.status === 403 || (res.status === 429 && res?.retryAfterHeader)) {
            if (this.proxies?.length) {
                this.rotateProxy();
                this.reLoginRequired = true;
            }
            if (!this.storeConfig.ignore_sleep) {
                let cooldown = Number(res.retryAfterHeader);
                this.logger.error(`Too many requests, we need to cooldown and sleep ${cooldown} seconds`);
                for (const notifier of this.notifiers) {
                    await notifier.notifyRateLimit(cooldown);
                }
                if (cooldown > 300) {
                    this.reLoginRequired = true;
                    cooldown = 320;
                }
                await sleep(cooldown * 1000);
            }
        }

        if (res.status === 403 || res.status === 0) {
            this.reLoginRequired = true;
            this.reLaunchRequired = true;
        }
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
                        if (this.id === "modernizr") {
                            return 1;
                        }
                        return elementDescriptor?.get?.apply(this);
                    },
                });
            });
        } catch (e) {
            this.logger.error("Unable to patch hairline detection, error %O", e);
        }
    }

    private async cleanOldReferences() {
        if (this.page) {
            try {
                await this.page.close();
            } catch (e) {
                this.logger.error("Unable to close page, %O", e);
            } finally {
                this.page = undefined;
            }
        }
        if (this.context) {
            try {
                await this.context.close();
            } catch (e) {
                this.logger.error("Unable to close context, %O", e);
            } finally {
                this.context = undefined;
            }
        }
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) {
                this.logger.error("Unable to close browser, %O", e);
            } finally {
                this.browser = undefined;
            }
        }
    }
}
