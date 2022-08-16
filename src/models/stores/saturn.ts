import { CommonStore } from "./abstract-store.js";
import type { Store } from "./store.js";

export class Saturn extends CommonStore implements Store {
    readonly baseUrl = "https://www.saturn.de";
    readonly countryCode = "DE";
    readonly languageCode = "de";
    readonly salesLine = "Saturn";
    readonly shortCode = "saturn";
    readonly thumbnail = "https://www.saturn.de/public/manifest/splashscreen-Saturn-512x512.png";

    getName(): string {
        return "Saturn";
    }

    getShortName(): string {
        return "Saturn";
    }
}
