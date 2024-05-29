import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktPoland extends CommonStore implements Store {
    readonly baseUrl = "https://mediamarkt.pl";
    readonly countryCode = "PL";
    readonly languageCode = "pl";
    readonly salesLine = "Media";
    readonly shortCode = "mmpl";
    readonly thumbnail = "https://mediamarkt.pl/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaMarkt Poland";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
