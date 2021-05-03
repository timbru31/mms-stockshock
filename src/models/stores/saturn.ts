import { CommonStore } from "./abstract-store";
import { Store } from "./store";

export class Saturn extends CommonStore implements Store {
    MIN_SLEEP_TIME = 750;
    MAX_SLEEP_TIME = 2500;

    readonly baseUrl = "https://www.saturn.de";
    readonly countryCode = "DE";
    readonly salesLine = "Saturn";

    getName(): string {
        return "Saturn";
    }
}
