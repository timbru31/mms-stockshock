import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktSwitzerland extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.ch";
    readonly countryCode = "CH";
    readonly languageCode = "de";
    readonly salesLine = "Media";
    readonly shortCode = "mmch";
    readonly thumbnail = "https://www.mediamarkt.ch/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Switzerland";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
