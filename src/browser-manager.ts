import { prompt } from "inquirer";
import { Browser, BrowserContext, Page, PuppeteerNodeLaunchOptions, SerializableOrJSHandle } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import UserAgent from "user-agents";
import { v4 } from "uuid";
import { Logger } from "winston";
import { Response } from "./models/api/response";
import { StoreConfiguration } from "./models/stores/config-model";
import { Store } from "./models/stores/store";
import { Notifier } from "./notifier";
import { GRAPHQL_CLIENT_VERSION, sleep } from "./utils";

export class BrowserManager {
    reLoginRequired = false;
    loggedIn = false;
    page: Page | undefined;

    private browser: Browser | undefined;
    private context: BrowserContext | undefined;
    private readonly store: Store;
    private readonly storeConfig: StoreConfiguration;
    private readonly logger: Logger;
    private readonly notifier: Notifier;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger, notifier: Notifier) {
        this.logger = logger;
        this.store = store;
        this.storeConfig = storeConfig;
        this.notifier = notifier;
    }

    async launchPuppeteer(headless = true, sandbox = true): Promise<void> {
        const args = [];
        if (!sandbox) {
            args.push("--no-sandbox");
        }

        if (this.storeConfig.proxy_url) {
            args.push(`--proxy-server=${this.storeConfig.proxy_url}`);
        }

        this.browser = await puppeteer.launch(({
            headless,
            defaultViewport: null,
            args,
        } as unknown) as PuppeteerNodeLaunchOptions);
    }

    async logIn(headless = true): Promise<void> {
        if (!this.browser) {
            throw new Error("Puppeteer context not inialized!");
        }

        let contextCreated = false;
        try {
            contextCreated = await Promise.race([this.createIncognitoContext(false), sleep(6000, false)]);
        } catch (e) {
            this.logger.error("Context creation failed, error %O", e);
        }
        if (!contextCreated) {
            this.logger.error(`Login did not succeed, please restart with '--no-headless' option. Context could not be created`);
            process.exit(1);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let res: { status: number; body?: any };
        try {
            res = await Promise.race([
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                this.page!.evaluate(
                    async (store: Store, email: string, password: string, flowId: string, graphQLClientVersion: string) =>
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
                            body: JSON.stringify({
                                operationName: "LoginProfileUser",
                                variables: { email, password },
                                extensions: {
                                    pwa: { salesLine: store.salesLine, country: store.countryCode, language: "de" },
                                    persistedQuery: {
                                        version: 1,
                                        sha256Hash: "48888a2943b5b790b95fce729554b6f0818eda790466ca59b074156da0723746",
                                    },
                                },
                            }),
                            method: "POST",
                            mode: "cors",
                        })
                            .then((res) =>
                                res.status === 200
                                    ? res
                                          .json()
                                          .then((data) => ({ status: res.status, body: data }))
                                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                          .catch((_) => ({ status: res.status, body: null, retryAfter: res.headers.get("Retry-After") }))
                                    : res.text().then((data) => ({ status: res.status, body: data }))
                            )
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            .catch((_) => ({ status: -1, body: null })),
                    this.store as SerializableOrJSHandle,
                    this.storeConfig.email,
                    this.storeConfig.password,
                    v4(),
                    GRAPHQL_CLIENT_VERSION
                ),
                sleep(5000, {
                    status: 0,
                    body: { errors: "Timeout" },
                }),
            ]);
        } catch (e) {
            res = { status: -1 };
            this.logger.error(e);
        }
        if (res.status !== 200 || !res.body || res.body?.errors) {
            if (headless) {
                this.logger.error(`Login did not succeed, please restart with '--no-headless' option, Status ${res.status}`);
                if (res.body?.errors) {
                    this.logger.error("Errors: %O", res.body);
                }
                await this.notifier.notifyAdmin(`😵 [${this.store.getName()}] I'm dying. Hopefully your Docker restarts me!`);
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

    async createIncognitoContext(exitOnFail = true): Promise<boolean> {
        if (this.context) {
            await this.context.close();
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.context = await this.browser!.createIncognitoBrowserContext();
        puppeteer.use(StealthPlugin());

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.page = await this.browser!.newPage();
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
            if (exitOnFail) {
                process.exit(1);
            }
            return false;
        }

        if (this.store.loginSleepTime) {
            await sleep(this.store.loginSleepTime);
        }
        return true;
    }

    async handleResponseError(res: { status: number; body: Response | null; retryAfterHeader: string | null }): Promise<void> {
        this.logger.error(`Query did not succeed, status code: ${res.status}`);
        if (res?.body?.errors) {
            this.logger.error("Error: %O", res.body.errors);
        }
        if (res.status === 429 && res?.retryAfterHeader && !this.storeConfig.ignore_sleep) {
            let cooldown = Number(res.retryAfterHeader);
            this.logger.error(`Too many requests, we need to cooldown and sleep ${cooldown} seconds`);
            await this.notifier.notifyRateLimit(cooldown);
            if (cooldown > 300) {
                this.reLoginRequired = true;
                cooldown = 320;
            }
            await sleep(cooldown * 1000);
        }

        if (res.status === 403 || res.status === 0) {
            this.reLoginRequired = true;
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
}
