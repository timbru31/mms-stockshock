import { Store } from "./store";

export abstract class CommonStore implements Store {
    private MIN_SLEEP_TIME = 100;
    private MAX_SLEEP_TIME = 500;

    abstract baseUrl: string;
    abstract countryCode: string;
    abstract languageCode: string;
    abstract salesLine: string;
    abstract shortCode: string;

    abstract getName(): string;
    abstract getShortName(): string;

    setSleepTimes(minSleepTime: undefined | number, maxSleepTime: undefined | number): void {
        if (minSleepTime) {
            this.MIN_SLEEP_TIME = minSleepTime;
        }
        if (maxSleepTime) {
            this.MAX_SLEEP_TIME = maxSleepTime;
        }
    }

    getSleepTime(): number {
        return Math.random() * (this.MAX_SLEEP_TIME - this.MIN_SLEEP_TIME) + this.MIN_SLEEP_TIME;
    }

    [key: string]:
        | string
        | number
        | undefined
        | (() => number)
        | (() => string)
        | ((minSleepTime: undefined | number, maxSleepTime: undefined | number) => void);
}
