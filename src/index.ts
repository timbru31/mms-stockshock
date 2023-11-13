import type { Logger } from "winston";
import { BasketAdder } from "./cookies/basket-adder";
import { BrowserManager } from "./core/browser-manager";
import { CooldownManager } from "./core/cooldown-manager";
import type { DatabaseConnection } from "./databases/database-connection";
import { DynamoDBStore } from "./databases/dynamodb-store";
import type { Product } from "./models/api/product";
import type { CliArguments } from "./models/cli";
import type { Notifier } from "./models/notifier";
import { DiscordNotifier, LoggerNotifier, TelegramNotifier, TwitterNotifier, WebSocketNotifier } from "./notifiers";
import { CategoryChecker } from "./stock-checkers/category-checker";
import { SearchChecker } from "./stock-checkers/search-checker";
import { WishlistChecker } from "./stock-checkers/wishlist-checker";
import { getStoreAndStoreConfig } from "./utils/cli-helper";
import { createLogger, loadConfig, sleep } from "./utils/utils";

async function reLoginIfRequired(
    browserManager: BrowserManager,
    args: CliArguments,
    email: string,
    password: string,
    notifiers: Notifier[],
    logger: Logger,
    newLoginMethod: boolean,
) {
    if (browserManager.reLoginRequired) {
        logger.info("Re-Login required!");
        if (browserManager.reLaunchRequired) {
            logger.info("Re-Launch required!");
            if (!(await browserManager.launchPuppeteer(args.headless, args.sandbox, args.shmUsage))) {
                for (const notifier of notifiers) {
                    await notifier.notifyAdmin("⚡️ Puppeteer could not be launched, restarting!");
                }
                process.kill(process.pid, "SIGINT");
            }
        }
        if (!(await browserManager.createFreshContext())) {
            browserManager.reLoginRequired = true;
            browserManager.reLaunchRequired = true;
            throw new Error("Fresh context could not be created!");
        }
        browserManager.reLoginRequired = false;
        browserManager.reLaunchRequired = false;
        logger.info("Fresh context created!");
        if (newLoginMethod) {
            await browserManager.logInV2(email, password, args.headless);
        } else {
            await browserManager.logIn(email, password, args.headless);
        }
        for (const notifier of notifiers) {
            await notifier.notifyAdmin("🤖 (Re-)Login succeeded, let's hunt");
        }
    }
}

async function reLaunchIfRequired(
    browserManager: BrowserManager,
    args: CliArguments,
    logger: Logger,
    notifiers: Notifier[],
    createNewContext?: boolean,
) {
    let relaunched = false;
    if (browserManager.reLaunchRequired) {
        logger.info("Re-Launch required!");
        if (!(await browserManager.launchPuppeteer(args.headless, args.sandbox, args.shmUsage))) {
            for (const notifier of notifiers) {
                await notifier.notifyAdmin("⚡️ Puppeteer could not be launched, restarting!");
            }
            process.kill(process.pid, "SIGINT");
        }
        relaunched = true;
    }
    if (createNewContext ?? relaunched) {
        if (!(await browserManager.createFreshContext())) {
            throw new Error("Fresh context could not be created!");
        }
        logger.info("Fresh context created!");
    }
}
void (async function () {
    const logger = createLogger();
    const configFile = await loadConfig(logger);
    if (!configFile) {
        return;
    }

    const { store, storeConfig, args } = await getStoreAndStoreConfig(configFile);

    if (storeConfig.proxy_urls?.length && storeConfig.proxy_url) {
        throw new Error("Can't use proxy_url and proxy_urls together, choose one!");
    }

    const cooldownManager = new CooldownManager(storeConfig);
    cooldownManager.cleanupCooldowns();

    let cookieStore: DatabaseConnection | undefined;
    if (storeConfig.dynamo_db_region && storeConfig.dynamo_db_table_name) {
        cookieStore = new DynamoDBStore(store, storeConfig);
    }

    const notifiers: Notifier[] = [new LoggerNotifier(store, storeConfig, logger)];
    if (storeConfig.discord_bot_token) {
        const discordNotifier = new DiscordNotifier(store, storeConfig, logger);
        notifiers.push(discordNotifier);

        const discordSleepTime = 500;
        while (!discordNotifier.discordBotReady) {
            logger.info("💤 Delaying start until Discord bot is ready");
            await sleep(discordSleepTime);
        }
    }

    if (storeConfig.use_websocket) {
        const webSocketNotifier = new WebSocketNotifier(storeConfig, logger);
        notifiers.push(webSocketNotifier);
    }
    if (
        storeConfig.twitter_api_key &&
        storeConfig.twitter_api_key_secret &&
        storeConfig.twitter_access_token &&
        storeConfig.twitter_access_token_secret
    ) {
        const twitterNotifier = new TwitterNotifier(store, storeConfig, logger);
        notifiers.push(twitterNotifier);
    }

    if (storeConfig.telegram_channel_id && storeConfig.telegram_bot_api_key) {
        const telegramNotifier = new TelegramNotifier(store, storeConfig, logger);
        notifiers.push(telegramNotifier);
    }

    const browserManager = new BrowserManager(store, storeConfig, logger, notifiers);
    const wishlistChecker = new WishlistChecker(store, storeConfig, logger, browserManager, cooldownManager, notifiers, cookieStore);
    const categoryChecker = new CategoryChecker(store, storeConfig, logger, browserManager, cooldownManager, notifiers, cookieStore);
    const searchChecker = new SearchChecker(store, storeConfig, logger, browserManager, cooldownManager, notifiers, cookieStore);
    const basketAdder = new BasketAdder(store, storeConfig, logger, browserManager, cooldownManager, notifiers, cookieStore);

    ["unhandledRejection", "uncaughtException"].forEach((evt) => {
        process.on(evt, (reason, promise) => {
            logger.error("⚡️ Unhandled Rejection at: %O", promise);
            logger.error("⚡️ Unhandled Rejection reason: %O", reason);
            process.kill(process.pid, "SIGINT");
        });
    });

    let shouldRun = true;
    ["SIGINT", "SIGTERM"].forEach((evt) => {
        process.on(evt, () => {
            console.log("👋 Shutting down...");
            for (const notifier of notifiers) {
                notifier.shutdown();
            }
            cooldownManager.saveCooldowns();
            void browserManager.shutdown();
            shouldRun = false;
            const failure = 1;
            process.exit(failure);
        });
    });

    if (!(await browserManager.launchPuppeteer(args.headless, args.sandbox, args.shmUsage))) {
        for (const notifier of notifiers) {
            await notifier.notifyAdmin("⚡️ Puppeteer could not be launched, restarting!");
        }
        process.kill(process.pid, "SIGINT");
    }

    const categoryRaceTimeout = 10000;
    const wishlistRaceTimeout = 60000;
    const loginRaceTimeout = 30000;

    while (shouldRun) {
        try {
            logger.info("🤖 Beep, I'm alive and well checking your stock");

            for (const [email, password] of storeConfig.accounts) {
                if (storeConfig.accounts.length > 1) {
                    browserManager.reLoginRequired = true;
                }
                logger.info(`💌 Checking wishlist items for account ${email}`);
                try {
                    await Promise.race([
                        reLoginIfRequired(browserManager, args, email, password, notifiers, logger, storeConfig.use_new_login ?? false),
                        sleep(loginRaceTimeout),
                    ]);
                } catch (e: unknown) {
                    for (const notifier of notifiers) {
                        await notifier.notifyAdmin(`⚡️ Boop, I'm alive but checking wishlist for ${email} errored`, e);
                    }
                    continue;
                }
                const basketProducts = await Promise.race([
                    wishlistChecker.checkWishlist(),
                    sleep(wishlistRaceTimeout, new Map<string, Product>()),
                ]);
                basketAdder.addNewProducts(basketProducts);
            }

            if (storeConfig.categories?.length) {
                if (storeConfig.accounts.length > 1) {
                    await reLaunchIfRequired(browserManager, args, logger, notifiers, true);
                }
                for (const categoryId of storeConfig.categories) {
                    await reLaunchIfRequired(browserManager, args, logger, notifiers);
                    logger.info(`📄 Checking category ${categoryId}`);
                    await sleep(store.getSleepTime());
                    const basketProducts = await Promise.race([
                        categoryChecker.checkCategory(categoryId, storeConfig.category_regex),
                        sleep(categoryRaceTimeout, new Map<string, Product>()),
                    ]);
                    basketAdder.addNewProducts(basketProducts);
                }
            }

            if (storeConfig.searches?.length) {
                if (storeConfig.accounts.length > 1) {
                    await reLaunchIfRequired(browserManager, args, logger, notifiers, true);
                }
                for (const search of storeConfig.searches) {
                    await reLaunchIfRequired(browserManager, args, logger, notifiers);
                    logger.info(`📄 Checking search "${search}"`);
                    await sleep(store.getSleepTime());
                    const basketProducts = await Promise.race([
                        searchChecker.checkSearch(search, storeConfig.search_regex, storeConfig.search_price_range),
                        sleep(categoryRaceTimeout, new Map<string, Product>()),
                    ]);
                    basketAdder.addNewProducts(basketProducts);
                }
            }

            await sleep(store.getSleepTime());
            const defaultCookiesAmount = 10;
            await basketAdder.createBasketCookies(storeConfig.cookies ?? defaultCookiesAmount);

            cooldownManager.cleanupCooldowns();
            await sleep(store.getSleepTime());
        } catch (e: unknown) {
            for (const notifier of notifiers) {
                await notifier.notifyAdmin("⚡️ Boop, I'm alive but checking your stock errored!", e);
            }
            if (e instanceof Error && e.message.includes("Failed to launch the browser process")) {
                process.kill(process.pid, "SIGINT");
            } else {
                browserManager.reLoginRequired = true;
                browserManager.reLaunchRequired = true;
            }
        }
    }
})();
