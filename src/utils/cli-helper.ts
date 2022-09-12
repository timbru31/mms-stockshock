import type { ListChoiceOptions } from "inquirer";
import { prompt } from "inquirer";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { CliArguments } from "../models/cli";
import type { ConfigModel, StoreConfiguration } from "../models/stores/config-model";
import { MediaMarktAustria } from "../models/stores/media-markt-austria";
import { MediaMarktGermany } from "../models/stores/media-markt-germany";
import { MediaMarktNetherlands } from "../models/stores/media-markt-netherlands";
import { MediaMarktSpain } from "../models/stores/media-markt-spain";
import { MediaWorldItaly } from "../models/stores/media-world-italy";
import { Saturn } from "../models/stores/saturn";
import type { Store } from "../models/stores/store";

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
        const storePrompt = await prompt({
            type: "list",
            name: "store",
            message: "Please choose the desired store...",
            choices: [
                {
                    name: "MediaMarkt Austria",
                    value: "mediamarkt austria",
                } as ListChoiceOptions,
                {
                    name: "MediaMarkt Germany",
                    value: "mediamarkt germany",
                } as ListChoiceOptions,

                {
                    name: "MediaWorld Italy",
                    value: "mediaworld italy",
                } as ListChoiceOptions,

                {
                    name: "MediaMarkt Netherlands",
                    value: "mediamarkt netherlands",
                } as ListChoiceOptions,

                {
                    name: "MediaMarkt Spain",
                    value: "mediamarkt spain",
                } as ListChoiceOptions,

                {
                    name: "Saturn",
                    value: "saturn",
                } as ListChoiceOptions,
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
        case "mmit":
        case "mwit":
        case "mediaworlditaly":
        case "mediamarktitaly":
        case "mediaworld italy":
        case "mediamarkt italy":
            store = new MediaWorldItaly();
            storeConfig = config.mmit;
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
