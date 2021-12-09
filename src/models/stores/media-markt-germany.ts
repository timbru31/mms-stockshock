import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktGermany extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.de";
    readonly countryCode = "DE";
    readonly languageCode = "de";
    readonly salesLine = "Media";
    readonly shortCode = "mmde";
    readonly thumbnail = "https://www.mediamarkt.de/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Germany";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
