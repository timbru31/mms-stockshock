import colors from "colors/safe";
import { readFile } from "fs/promises";
import { prompt } from "inquirer";
import { parse } from "toml";
import { createLogger, format, Logger, transports } from "winston";

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

    const args = process.argv.slice(2);
    const config = await loadConfig(logger);
    if (!config) {
        return;
    }
    let storeConfig: StoreConfiguration;
    const storePrompt = await prompt({
        type: "list",
        name: "store",
        message: "Please choose the desired store...",
        choices: ["Saturn", "MediaMarkt Germany", "MediaMarkt Austria"],
    });
    let store: Store;
    switch (storePrompt.store) {
        case "Saturn":
            store = new Saturn();
            storeConfig = config.saturn;
            break;
        case "MediaMarkt Germany":
            store = new MediaMarktGermany();
            storeConfig = config.mmde;
            break;
        case "MediaMarkt Austria":
            store = new MediaMarktAustria();
            storeConfig = config.mmat;
            break;
        default:
            throw new Error("Invalid store chosen!");
    }
    const stockChecker = new StockChecker(store, logger, storeConfig.webhook_url);
    await stockChecker.logIn(storeConfig.email, storeConfig.password, !args.includes("--no-headless"));
    logger.info("Login succeeded, let's hunt!");

    // eslint-disable-next-line no-constant-condition
    while (true) {
        await stockChecker.checkStock();
        await new Promise((resolve) => setTimeout(resolve, store.getSleepTime()));
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
