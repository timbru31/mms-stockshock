import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ConfigModel, StoreConfiguration } from "../models/stores/config-model";
import { Saturn } from "../models/stores/saturn";
import { Store } from "../models/stores/store";
import { prompt } from "inquirer";
import { MediaMarktGermany } from "../models/stores/media-markt-germany";
import { MediaMarktAustria } from "../models/stores/media-markt-austria";
import { CliArguments } from "../models/cli";

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

    return { store, storeConfig, args };
}
