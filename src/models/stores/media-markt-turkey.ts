import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktTurkey extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.com.tr";
    readonly countryCode = "TR";
    readonly languageCode = "tr";
    readonly salesLine = "Media";
    readonly shortCode = "mmtr";
    readonly thumbnail = "https://www.mediamarkt.com.tr/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Turkey";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
