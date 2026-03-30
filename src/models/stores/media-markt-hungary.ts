import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktHungary extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.hu";
    readonly countryCode = "HU";
    readonly languageCode = "hu";
    readonly salesLine = "Media";
    readonly shortCode = "mmhu";
    readonly thumbnail = "https://www.mediamarkt.hu/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Hungary";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
