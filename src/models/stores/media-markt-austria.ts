import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktAustria extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.at";
    readonly countryCode = "AT";
    readonly languageCode = "de";
    readonly salesLine = "Media";
    readonly shortCode = "mmat";
    readonly loginSleepTime = 2500;
    readonly thumbnail = "https://www.mediamarkt.at/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Austria";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
