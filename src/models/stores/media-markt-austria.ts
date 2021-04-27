import { CommonStore } from "./abstract-store";
import { Store } from "./store";

export class MediaMarktAustria extends CommonStore implements Store {
    readonly baseUrl = "https://www.mediamarkt.at";
    readonly countryCode = "AT";
    readonly salesLine = "Media";
}
