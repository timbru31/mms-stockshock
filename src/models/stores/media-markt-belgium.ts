import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktBelgium extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.be";
    readonly countryCode = "BE";
    readonly languageCode = "nl";
    readonly salesLine = "Media";
    readonly shortCode = "mmbe";
    readonly thumbnail = "https://www.mediamarkt.be/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Belgium";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
