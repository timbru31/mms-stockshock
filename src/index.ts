import colors from "colors/safe";
import { readFile } from "fs/promises";
import { prompt } from "inquirer";
import { parse } from "toml";
import { createLogger, format, Logger, transports } from "winston";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ConfigModel, StoreConfiguration } from "./models/stores/config-model";
import { MediaMarktAustria } from "./models/stores/media-markt-austria";
import { MediaMarktGermany } from "./models/stores/media-markt-germany";
import { Saturn } from "./models/stores/saturn";
import { Store } from "./models/stores/store";
import { StockChecker } from "./stock-checker";

const getEmojiForLevel = (level: string) => {
    switch (colors.stripColors(level)) {
        case "info":
            return "🧚";
        case "error":
        default:
            return "⚡️";
    }
};

const customLogFormat = format.printf((info) => {
    return `${info.timestamp} [${getEmojiForLevel(info.level)}] ${info.level}: ${info.message} `;
});

(async function () {
    const logger = createLogger({
        transports: [
            new transports.File({
                filename: "stockshock.log",
                format: format.combine(
                    format.timestamp({
                        format: "YYYY-MM-DD HH:mm:ss",
                    }),
                    format.errors({ stack: true }),
                    format.splat(),
                    customLogFormat
                ),
            }),
            new transports.Console({
                format: format.combine(
                    format.colorize(),
                    format.timestamp({
                        format: "YYYY-MM-DD HH:mm:ss",
                    }),
                    format.errors({ stack: true }),
                    format.splat(),
                    customLogFormat
                ),
            }),
        ],
    });

    const config = await loadConfig(logger);
    if (!config) {
        return;
    }

    const args = yargs(hideBin(process.argv)).options({
        headless: { type: "boolean", default: true },
        sandbox: { type: "boolean", default: true },
        store: { type: "string", default: "" },
    }).argv;
    let storeConfig: StoreConfiguration;
    let storeArgument: string;
    if (!args.store) {
        const storePrompt = await prompt({
            type: "list",
            name: "store",
            message: "Please choose the desired store...",
            choices: [
                {
                    name: "Saturn",
                    value: "saturn",
                },
                {
                    name: "MediaMarkt Germany",
                    value: "mediamarkt germany",
                },
                {
                    name: "MediaMarkt Austria",
                    value: "mediamarkt austria",
                },
            ],
        });
        storeArgument = storePrompt.store;
    } else {
        storeArgument = args.store;
    }
    let store: Store;
    switch (storeArgument.toLowerCase()) {
        case "saturn":
            store = new Saturn();
            storeConfig = config.saturn;
            break;
        case "mmde":
        case "mediamarktgermany":
        case "mediamarkt germany":
            store = new MediaMarktGermany();
            storeConfig = config.mmde;
            break;
        case "mmat":
        case "mediamarktaustria":
        case "mediamarkt austria":
            store = new MediaMarktAustria();
            storeConfig = config.mmat;
            break;
        default:
            throw new Error("Invalid store chosen!");
    }
    const stockChecker = new StockChecker(store, logger, storeConfig);
    await stockChecker.launchPuppeteer(storeConfig, args.headless, args.sandbox);
    await stockChecker.logIn(storeConfig, args.headless);
    logger.info("Login succeeded, let's hunt!");

    process.on("unhandledRejection", (reason, promise) => {
        logger.error("Unhandled Rejection at: %O", promise);
        logger.error("Unhandled Rejection reason: %O", reason);
    });

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            logger.info("🤖 Beep, I'm alive and well checking your stock");
            await stockChecker.checkStock();
            if (stockChecker.cartItems.size) {
                await stockChecker.createCartCookies(storeConfig);
                stockChecker.cartItems.clear();
            }
            await new Promise((resolve) => setTimeout(resolve, store.getSleepTime()));
            stockChecker.cleanupCooldowns();
            if (stockChecker.reLoginRequired) {
                await stockChecker.logIn(storeConfig, args.headless);
                logger.info("Re-Login succeeded, let's hunt!");
            }
        } catch (e) {
            logger.info("🤖 Boop, I'm alive but checking your stock errored: %O", e);
        }
    }
})();

async function loadConfig(logger: Logger) {
    const configFile = await readFile("stores.toml", "utf-8");
    let config: ConfigModel | null = null;
    try {
        config = parse(configFile);
    } catch (e) {
        logger.error("Uh oh! Unable to parse the config file!");
        logger.error(e);
    }
    return config;
}
