import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktNetherlands extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.nl";
    readonly countryCode = "NL";
    readonly languageCode = "nl";
    readonly salesLine = "Media";
    readonly shortCode = "mmnl";
    readonly thumbnail = "https://www.mediamarkt.nl/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Netherlands";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
