import { Store } from "./store";

export abstract class CommonStore implements Store {
    MIN_SLEEP_TIME = 100;
    MAX_SLEEP_TIME = 500;

    abstract baseUrl: string;
    abstract countryCode: string;
    abstract languageCode: string;
    abstract salesLine: string;
    abstract shortCode: string;

    abstract getName(): string;
    abstract getShortName(): string;

    getSleepTime(): number {
        return Math.random() * (this.MAX_SLEEP_TIME - this.MIN_SLEEP_TIME) + this.MIN_SLEEP_TIME;
    }

    [key: string]: string | number | (() => number) | (() => string);
}
