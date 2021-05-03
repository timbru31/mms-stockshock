import { CommonStore } from "./abstract-store";
import { Store } from "./store";

export class MediaMarktGermany extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.de";
    readonly countryCode = "DE";
    readonly salesLine = "Media";

    getName(): string {
        return "MediaMarkt";
    }
}
