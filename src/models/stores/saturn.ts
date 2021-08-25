import { CommonStore } from "./abstract-store";
import type { Store } from "./store";

export class Saturn extends CommonStore implements Store {
    readonly baseUrl = "https://www.saturn.de";
    readonly countryCode = "DE";
    readonly languageCode = "de";
    readonly salesLine = "Saturn";
    readonly shortCode = "saturn";

    getName(): string {
        return "Saturn";
    }

    getShortName(): string {
        return "Saturn";
    }
}
