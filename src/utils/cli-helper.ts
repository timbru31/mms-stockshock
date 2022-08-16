import inquirer from "inquirer";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { CliArguments } from "../models/cli.js";
import type { ConfigModel, StoreConfiguration } from "../models/stores/config-model.js";
import { MediaMarktAustria } from "../models/stores/media-markt-austria.js";
import { MediaMarktGermany } from "../models/stores/media-markt-germany.js";
import { MediaMarktNetherlands } from "../models/stores/media-markt-netherlands.js";
import { MediaMarktSpain } from "../models/stores/media-markt-spain.js";
import { Saturn } from "../models/stores/saturn.js";
import type { Store } from "../models/stores/store.js";

export async function getStoreAndStoreConfig(config: ConfigModel): Promise<{
    store: Store;
    storeConfig: StoreConfiguration;
    args: CliArguments;
}> {
    const args = yargs(hideBin(process.argv)).options({
        headless: { type: "boolean", default: true },
        sandbox: { type: "boolean", default: true },
        shmUsage: { type: "boolean", default: true },
        store: { type: "string", default: "" },
    }).argv as CliArguments;
    let storeConfig: StoreConfiguration;
    let storeArgument: string;
    if (!args.store) {
        const storePrompt = await inquirer.prompt({
            type: "list",
            name: "store",
            message: "Please choose the desired store...",
            choices: [
                {
                    name: "MediaMarkt Austria",
                    value: "mediamarkt austria",
                },
                {
                    name: "MediaMarkt Germany",
                    value: "mediamarkt germany",
                },
                {
                    name: "MediaMarkt Netherlands",
                    value: "mediamarkt netherlands",
                },
                {
                    name: "MediaMarkt Spain",
                    value: "mediamarkt spain",
                },
                {
                    name: "Saturn",
                    value: "saturn",
                },
            ],
        });
        storeArgument = storePrompt.store as string;
    } else {
        storeArgument = args.store;
    }
    let store: Store;
    switch (storeArgument.toLowerCase()) {
        case "mmat":
        case "mediamarktaustria":
        case "mediamarkt austria":
            store = new MediaMarktAustria();
            storeConfig = config.mmat;
            store.setSleepTimes(storeConfig.min_sleep_time, storeConfig.max_sleep_time);
            break;
        case "mmde":
        case "mediamarktgermany":
        case "mediamarkt germany":
            store = new MediaMarktGermany();
            storeConfig = config.mmde;
            store.setSleepTimes(storeConfig.min_sleep_time, storeConfig.max_sleep_time);
            break;
        case "mmnl":
        case "mediamarktnetherlands":
        case "mediamarkt netherlands":
            store = new MediaMarktNetherlands();
            storeConfig = config.mmnl;
            store.setSleepTimes(storeConfig.min_sleep_time, storeConfig.max_sleep_time);
            break;
        case "mmes":
        case "mediamarktspain":
        case "mediamarkt spain":
            store = new MediaMarktSpain();
            storeConfig = config.mmes;
            store.setSleepTimes(storeConfig.min_sleep_time, storeConfig.max_sleep_time);
            break;
        case "saturn":
            store = new Saturn();
            storeConfig = config.saturn;
            store.setSleepTimes(storeConfig.min_sleep_time, storeConfig.max_sleep_time);
            break;
        default:
            throw new Error("Invalid store chosen!");
    }

    return { store, storeConfig, args };
}
