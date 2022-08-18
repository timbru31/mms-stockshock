import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaWorldItaly extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediaworld.it";
    readonly countryCode = "IT";
    readonly languageCode = "it";
    readonly salesLine = "Media";
    readonly shortCode = "mmit";
    readonly thumbnail = "https://www.mediaworld.it/public/manifest/splashscreen-Media-512x512.png";

    getName(): string {
        return "MediaWorld Italy";
    }

    getShortName(): string {
        return "MediaWorld";
    }
}
