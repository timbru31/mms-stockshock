import { Logger } from "winston";
import { BasketAdder } from "./basket-adder";
import { BrowserManager } from "./browser-manager";
import { CategoryChecker } from "./category-checker";
import { getStoreAndStoreConfig } from "./cli-helper";
import { CooldownManager } from "./cooldown-manager";
import { DynamoDBCookieStore } from "./dynamodb-cookie-store";
import { Product } from "./models/api/product";
import { CliArguments } from "./models/cli";
import { Store } from "./models/stores/store";
import { Notifier } from "./notifier";
import { createLogger, loadConfig, sleep } from "./utils";
import { WishlistChecker } from "./wishlist-checker";

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
    const notifier = new Notifier(store, storeConfig, logger, cookieStore);
    if (storeConfig?.discord_bot_token) {
        while (!notifier.discordBotReady) {
            logger.info("💤 Delaying start until Discord bot is ready");
            await sleep(500);
        }
    }

    process.on("unhandledRejection", async (reason, promise) => {
        logger.error("⚡️ Unhandled Rejection at: %O", promise);
        logger.error("⚡️ Unhandled Rejection reason: %O", reason);
        await notifier.notifyAdmin(`🤖 [${store.getName()}] Unhandled Promise rejection!`);
    });

    let shouldRun = true;

    ["SIGINT", "SIGTERM"].forEach((evt) => {
        process.on(evt, () => {
            console.log("👋 Shutting down...");
            shouldRun = false;
            notifier.closeWebSocketServer();
            cooldownManager.saveCooldowns();
            browserManager.shutdown();
        });
    });

    const browserManager = new BrowserManager(store, storeConfig, logger, notifier);
    const wishlistChecker = new WishlistChecker(store, storeConfig, logger, browserManager, cooldownManager, notifier);
    const categoryChecker = new CategoryChecker(store, storeConfig, logger, browserManager, cooldownManager, notifier);
    const basketAdder = new BasketAdder(store, storeConfig, logger, browserManager, cooldownManager, notifier, cookieStore);
    await browserManager.launchPuppeteer(args.headless, args.sandbox);

    while (shouldRun) {
        try {
            logger.info("🤖 Beep, I'm alive and well checking your stock");

            for (const [email, password] of storeConfig.accounts) {
                if (storeConfig.accounts.length > 1) {
                    browserManager.reLoginRequired = true;
                }
                logger.info(`💌 Checking wishlist items for account ${email}`);
                try {
                    await Promise.race([reLoginIfRequired(browserManager, args, email, password, notifier, store, logger), sleep(30000)]);
                } catch (e) {
                    logger.info(`⚡️ Boop, I'm alive but checking whislist for ${email} errored`);
                    await notifier.notifyAdmin(`⚡️ [${store.getName()}] Boop, I'm alive but checking whislist for ${email} errored`);
                    continue;
                }
                const basketProducts = await Promise.race([wishlistChecker.checkWishlist(), sleep(60000, new Map<string, Product>())]);
                basketAdder.addNewProducts(basketProducts);
            }

            if (storeConfig.categories?.length) {
                if (storeConfig.accounts.length > 1) {
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
            await notifier.notifyAdmin(`⚡️ [${store.getName()}] Boop, I'm alive but checking your stock errored!`);
            browserManager.reLoginRequired = true;
        }
    }
    await browserManager.shutdown();
})();

async function reLoginIfRequired(
    browserManager: BrowserManager,
    args: CliArguments,
    email: string,
    password: string,
    notifier: Notifier,
    store: Store,
    logger: Logger
) {
    if (browserManager.reLoginRequired) {
        if (browserManager.reLaunchRequired) {
            await browserManager.launchPuppeteer(args.headless, args.sandbox);
        }
        if (!(await browserManager.createIncognitoContext())) {
            throw new Error("Incognito context could not be created!");
        }
        await browserManager.logIn(args.headless, email, password);
        await notifier.notifyAdmin(`🤖 [${store.getName()}] (Re-)Login succeeded, let's hunt`);
        logger.info("(Re-)Login succeeded, let's hunt!");
    }
}

async function reLaunchIfRequired(browserManager: BrowserManager, args: CliArguments, createNewContext?: boolean) {
    let relaunched = false;
    if (browserManager.reLaunchRequired) {
        await browserManager.launchPuppeteer(args.headless, args.sandbox);
        relaunched = true;
    }
    if (createNewContext || relaunched) {
        if (!(await browserManager.createIncognitoContext())) {
            throw new Error("Incognito context could not be created!");
        }
    }
}
