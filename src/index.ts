import { readFile } from "fs/promises";
import { prompt } from "inquirer";
import { parse } from "toml";

import { ConfigModel, StoreConfiguration } from "./models/stores/config-model";
import { MediaMarktAustria } from "./models/stores/media-markt-austria";
import { MediaMarktGermany } from "./models/stores/media-markt-germany";
import { Saturn } from "./models/stores/saturn";
import { Store } from "./models/stores/store";
import { StockChecker } from "./stock-checker";

const SLEEP_TIME = 2000;

(async function () {
    const args = process.argv.slice(2);
    const config: ConfigModel = await loadConfig();
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
    const stockChecker = new StockChecker(store, storeConfig.webhook_url);
    await stockChecker.logIn(storeConfig.email, storeConfig.password, !args.includes("--no-headless"));
    console.log("Login succeeded, let's hunt!");

    // eslint-disable-next-line no-constant-condition
    while (true) {
        await stockChecker.checkStock();
        await new Promise((resolve) => setTimeout(resolve, SLEEP_TIME));
    }
})();

async function loadConfig() {
    const configFile = await readFile("stores.toml", "utf-8");
    let config: ConfigModel;
    try {
        config = parse(configFile);
    } catch (e) {
        console.error("Unable to parse config file!", e);
        process.exit(1);
    }
    return config;
}
