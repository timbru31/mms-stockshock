import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class MediaMarktSpain extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.es";
    readonly countryCode = "ES";
    readonly languageCode = "es";
    readonly salesLine = "Media";
    readonly shortCode = "mmes";

    getName(): string {
        return "MediaMarkt Spain";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
