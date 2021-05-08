import { BrowserManager } from "./browser-manager";
import { getStoreAndStoreConfig } from "./cli-helper";
import { CooldownManager } from "./cooldown-manager";
import { Notifier } from "./notifier";
import { WishlistChecker } from "./wishlist-checker";
import { createLogger, loadConfig, sleep } from "./utils";
import { CartAdder } from "./cart-adder";
import { CategoryChecker } from "./category-checker";

(async function () {
    const logger = createLogger();
    const configFile = await loadConfig(logger);
    if (!configFile) {
        return;
    }

    const { store, storeConfig, args } = await getStoreAndStoreConfig(configFile);

    const cooldownManager = new CooldownManager();
    const notifier = new Notifier(store, storeConfig);

    process.on("unhandledRejection", async (reason, promise) => {
        logger.error("Unhandled Rejection at: %O", promise);
        logger.error("Unhandled Rejection reason: %O", reason);
        await notifier.notifyAdmin(`🤖 [${store.getName()}] Unhandled Promise rejection!`);
    });

    const browserManager = new BrowserManager(store, storeConfig, logger, notifier);
    await browserManager.launchPuppeteer(args.headless, args.sandbox);
    await browserManager.logIn(args.headless);
    logger.info("Login succeeded, let's hunt!");
    await notifier.notifyAdmin(`🤖 [${store.getName()}] Login succeded, let's hunt!`);

    const wishlistChecker = new WishlistChecker(store, logger, storeConfig, browserManager, cooldownManager);
    const categoryChecker = new CategoryChecker(store, logger, storeConfig, browserManager, cooldownManager);
    const cartAdder = new CartAdder(store, logger, storeConfig, browserManager, cooldownManager);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            logger.info("🤖 Beep, I'm alive and well checking your stock");
            logger.info("💌 Checking wishlist items");
            let cartProducts = await wishlistChecker.checkWishlist();
            cartAdder.addNewProducts(cartProducts);
            if (storeConfig.categories?.length) {
                for (const categoryId of storeConfig.categories) {
                    logger.info(`📄 Checking category ${categoryId}`);
                    cartProducts = await categoryChecker.checkCategory(categoryId, storeConfig.category_regex);
                    cartAdder.addNewProducts(cartProducts);
                }
            }
            await cartAdder.createCartCookies();

            await sleep(store.getSleepTime());
            cooldownManager.cleanupCooldowns();
            if (browserManager.reLoginRequired) {
                await browserManager.logIn(args.headless);
                await notifier.notifyAdmin(`🤖 [${store.getName()}] Re-Login required, but was OK!`);
                logger.info("Re-Login succeeded, let's hunt!");
            }
        } catch (e) {
            logger.info("🤖 Boop, I'm alive but checking your stock errored: %O", e);
            await notifier.notifyAdmin(`🤖 [${store.getName()}] Boop, I'm alive but checking your stock errored!`);
        }
    }
})();
