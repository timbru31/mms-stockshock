import { Logger } from "winston";
import { BrowserManager } from "./browser-manager";
import { CartAdder } from "./cart-adder";
import { CategoryChecker } from "./category-checker";
import { getStoreAndStoreConfig } from "./cli-helper";
import { CooldownManager } from "./cooldown-manager";
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
    const notifier = new Notifier(store, storeConfig, logger);

    process.on("unhandledRejection", async (reason, promise) => {
        logger.error("⚡️ Unhandled Rejection at: %O", promise);
        logger.error("⚡️ Unhandled Rejection reason: %O", reason);
        await notifier.notifyAdmin(`🤖 [${store.getName()}] Unhandled Promise rejection!`);
    });

    let shouldRun = true;

    process.on("SIGINT", async () => {
        console.log("👋 Shutting down...");
        shouldRun = false;
        await browserManager.shutdown();
    });

    const browserManager = new BrowserManager(store, storeConfig, logger, notifier);
    await browserManager.launchPuppeteer(args.headless, args.sandbox);
    await browserManager.logIn(args.headless);
    logger.info("Login succeeded, let's hunt!");
    await notifier.notifyAdmin(`🤖 [${store.getName()}] Login succeded, let's hunt!`);

    const wishlistChecker = new WishlistChecker(store, logger, browserManager, cooldownManager, notifier);
    const categoryChecker = new CategoryChecker(store, logger, browserManager, cooldownManager, notifier);
    const cartAdder = new CartAdder(store, logger, browserManager, cooldownManager, notifier);

    while (shouldRun) {
        try {
            logger.info("🤖 Beep, I'm alive and well checking your stock");
            logger.info("💌 Checking wishlist items");

            await reLoginIfRequired(browserManager, args, notifier, store, logger);
            let cartProducts = await wishlistChecker.checkWishlist();
            cartAdder.addNewProducts(cartProducts);
            await reLoginIfRequired(browserManager, args, notifier, store, logger);

            if (storeConfig.categories?.length) {
                for (const categoryId of storeConfig.categories) {
                    logger.info(`📄 Checking category ${categoryId}`);
                    await sleep(store.getSleepTime());
                    cartProducts = await categoryChecker.checkCategory(categoryId, storeConfig.category_regex);
                    cartAdder.addNewProducts(cartProducts);
                    await reLoginIfRequired(browserManager, args, notifier, store, logger);
                }
            }

            await sleep(store.getSleepTime());
            await cartAdder.createCartCookies();

            cooldownManager.cleanupCooldowns();
            await sleep(store.getSleepTime());
        } catch (e) {
            logger.info("🤖 Boop, I'm alive but checking your stock errored: %O", e);
            await notifier.notifyAdmin(`🤖 [${store.getName()}] Boop, I'm alive but checking your stock errored!`);
            browserManager.reLoginRequired = true;
        }
    }
    await browserManager.shutdown();
})();

async function reLoginIfRequired(browserManager: BrowserManager, args: CliArguments, notifier: Notifier, store: Store, logger: Logger) {
    if (browserManager.reLoginRequired) {
        await browserManager.launchPuppeteer(args.headless, args.sandbox);
        await browserManager.logIn(args.headless);
        await notifier.notifyAdmin(`🤖 [${store.getName()}] Re-Login required, but was OK!`);
        logger.info("Re-Login succeeded, let's hunt!");
    }
}
