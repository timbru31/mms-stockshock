import { Logger } from "winston";
import { BasketAdder } from "./cookies/basket-adder";
import { BrowserManager } from "./core/browser-manager";
import { CategoryChecker } from "./stock-checkers/category-checker";
import { getStoreAndStoreConfig } from "./utils/cli-helper";
import { CooldownManager } from "./core/cooldown-manager";
import { DynamoDBCookieStore } from "./cookies/dynamodb-cookie-store";
import { Product } from "./models/api/product";
import { CliArguments } from "./models/cli";
import { Store } from "./models/stores/store";
import { createLogger, loadConfig, sleep } from "./utils/utils";
import { WishlistChecker } from "./stock-checkers/wishlist-checker";
import { Notifier } from "./models/notifier";
import { DiscordNotifier, TwitterNotifier, WebSocketNotifier } from "./notifiers";

(async function () {
    const logger = createLogger();
    const configFile = await loadConfig(logger);
    if (!configFile) {
        return;
    }

    const { store, storeConfig, args } = await getStoreAndStoreConfig(configFile);

    if (storeConfig?.proxy_urls?.length && storeConfig.proxy_url) {
        throw new Error("Can't use proxy_url and proxy_urls together, choose one!");
    }

    const cooldownManager = new CooldownManager();

    let cookieStore: DynamoDBCookieStore | undefined;
    if (storeConfig.dynamo_db_region && storeConfig.dynamo_db_table_name) {
        cookieStore = new DynamoDBCookieStore(store, storeConfig);
    }

    const notifiers: Notifier[] = [];
    if (storeConfig?.discord_bot_token) {
        const discordNotifier = new DiscordNotifier(store, storeConfig, logger, cookieStore);
        notifiers.push(discordNotifier);

        while (!discordNotifier.discordBotReady) {
            logger.info("💤 Delaying start until Discord bot is ready");
            await sleep(500);
        }
    }

    if (storeConfig?.use_websocket) {
        const webSocketNotifier = new WebSocketNotifier(storeConfig, logger);
        notifiers.push(webSocketNotifier);
    }
    if (
        storeConfig?.twitter_api_key &&
        storeConfig?.twitter_api_key_secret &&
        storeConfig?.twitter_access_token &&
        storeConfig?.twitter_access_token_secret
    ) {
        const twitterNotifier = new TwitterNotifier(store, storeConfig, logger);
        notifiers.push(twitterNotifier);
    }

    ["unhandledRejection", "uncaughtException"].forEach((evt) => {
        process.on(evt, async (reason, promise) => {
            logger.error("⚡️ Unhandled Rejection at: %O", promise);
            logger.error("⚡️ Unhandled Rejection reason: %O", reason);
            browserManager.reLaunchRequired = true;
            browserManager.reLoginRequired = true;
        });
    });

    let shouldRun = true;

    ["SIGINT", "SIGTERM"].forEach((evt) => {
        process.on(evt, () => {
            console.log("👋 Shutting down...");
            shouldRun = false;
            for (const notifier of notifiers) {
                notifier.shutdown();
            }
            cooldownManager.saveCooldowns();
            browserManager.shutdown();
        });
    });

    const browserManager = new BrowserManager(store, storeConfig, logger, notifiers);
    const wishlistChecker = new WishlistChecker(store, storeConfig, logger, browserManager, cooldownManager, notifiers);
    const categoryChecker = new CategoryChecker(store, storeConfig, logger, browserManager, cooldownManager, notifiers);
    const basketAdder = new BasketAdder(store, storeConfig, logger, browserManager, cooldownManager, notifiers, cookieStore);
    await browserManager.launchPuppeteer(args.headless, args.sandbox, args.shmUsage);

    while (shouldRun) {
        try {
            logger.info("🤖 Beep, I'm alive and well checking your stock");

            for (const [email, password] of storeConfig.accounts || []) {
                if (storeConfig?.accounts?.length > 1) {
                    browserManager.reLoginRequired = true;
                }
                logger.info(`💌 Checking wishlist items for account ${email}`);
                try {
                    await Promise.race([reLoginIfRequired(browserManager, args, email, password, notifiers, store, logger), sleep(30000)]);
                } catch (e) {
                    logger.info(`⚡️ Boop, I'm alive but checking wishlist for ${email} errored, %O`, e);
                    for (const notifier of notifiers) {
                        await notifier.notifyAdmin(`⚡️ [${store.getName()}] Boop, I'm alive but checking wishlist for ${email} errored`);
                    }
                    continue;
                }
                const basketProducts = await Promise.race([wishlistChecker.checkWishlist(), sleep(60000, new Map<string, Product>())]);
                basketAdder.addNewProducts(basketProducts);
            }

            if (storeConfig.categories?.length) {
                if (storeConfig?.accounts?.length > 1) {
                    await reLaunchIfRequired(browserManager, args, true);
                }
                for (const categoryId of storeConfig.categories) {
                    await reLaunchIfRequired(browserManager, args);
                    logger.info(`📄 Checking category ${categoryId}`);
                    await sleep(store.getSleepTime());
                    const basketProducts = await Promise.race([
                        categoryChecker.checkCategory(categoryId, storeConfig.category_regex),
                        sleep(10000, new Map<string, Product>()),
                    ]);
                    basketAdder.addNewProducts(basketProducts);
                }
            }

            await sleep(store.getSleepTime());
            await basketAdder.createBasketCookies(storeConfig.cookies ?? 10);

            cooldownManager.cleanupCooldowns();
            await sleep(store.getSleepTime());
        } catch (e) {
            logger.info("⚡️ Boop, I'm alive but checking your stock errored: %O", e);
            for (const notifier of notifiers) {
                await notifier.notifyAdmin(`⚡️ [${store.getName()}] Boop, I'm alive but checking your stock errored!`);
            }
            browserManager.reLoginRequired = true;
            browserManager.reLaunchRequired = true;
        }
    }
    await browserManager.shutdown();
})();

async function reLoginIfRequired(
    browserManager: BrowserManager,
    args: CliArguments,
    email: string,
    password: string,
    notifiers: Notifier[],
    store: Store,
    logger: Logger
) {
    if (browserManager.reLoginRequired) {
        if (browserManager.reLaunchRequired) {
            await browserManager.launchPuppeteer(args.headless, args.sandbox, args.shmUsage);
        }
        if (!(await browserManager.createIncognitoContext())) {
            throw new Error("Incognito context could not be created!");
        }
        await browserManager.logIn(args.headless, email, password);
        for (const notifier of notifiers) {
            await notifier.notifyAdmin(`🤖 [${store.getName()}] (Re-)Login succeeded, let's hunt`);
        }
        logger.info("(Re-)Login succeeded, let's hunt!");
    }
}

async function reLaunchIfRequired(browserManager: BrowserManager, args: CliArguments, createNewContext?: boolean) {
    let relaunched = false;
    if (browserManager.reLaunchRequired) {
        await browserManager.launchPuppeteer(args.headless, args.sandbox, args.shmUsage);
        relaunched = true;
    }
    if (createNewContext || relaunched) {
        if (!(await browserManager.createIncognitoContext())) {
            throw new Error("Incognito context could not be created!");
        }
    }
}
