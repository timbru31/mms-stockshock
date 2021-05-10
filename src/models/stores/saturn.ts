import { CommonStore } from "./abstract-store";
import { Store } from "./store";

export class Saturn extends CommonStore implements Store {
    readonly baseUrl = "https://www.saturn.de";
    readonly countryCode = "DE";
    readonly salesLine = "Saturn";

    getName(): string {
        return "Saturn";
    }
}
