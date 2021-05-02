import { Store } from "./store";

export abstract class CommonStore implements Store {
    MIN_SLEEP_TIME = 1000;
    MAX_SLEEP_TIME = 1000;

    abstract baseUrl: string;
    abstract countryCode: string;
    abstract salesLine: string;

    getSleepTime(): number {
        return Math.random() * (this.MAX_SLEEP_TIME - this.MIN_SLEEP_TIME) + this.MIN_SLEEP_TIME;
    }

    [key: string]: string | number | (() => number);
}
