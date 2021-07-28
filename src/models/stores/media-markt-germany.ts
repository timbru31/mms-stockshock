import { CommonStore } from "./abstract-store";
import { Store } from "./store";

export class MediaMarktGermany extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.de";
    readonly countryCode = "DE";
    readonly languageCode = "de";
    readonly salesLine = "Media";
    readonly shortCode = "mmde";

    getName(): string {
        return "MediaMarkt Germany";
    }

    getShortName(): string {
        return "MediaMarkt";
    }
}
