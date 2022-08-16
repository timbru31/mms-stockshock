import { CommonStore } from "./abstract-store.js";
import type { Store } from "./store.js";

export class MediaMarktSpain extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.es";
    readonly countryCode = "ES";
    readonly languageCode = "es";
    readonly salesLine = "Media";
    readonly shortCode = "mmes";
    readonly thumbnail = "https://www.mediamarkt.es/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Spain";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
