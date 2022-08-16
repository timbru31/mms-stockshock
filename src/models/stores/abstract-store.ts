import type { Store } from "./store.js";

export abstract class CommonStore implements Store {
    private readonly defaultMinSleepTime = 100;
    private readonly defaultMaxSleepTime = 500;
    private maxSleepTime = this.defaultMaxSleepTime;
    private minSleepTime = this.defaultMinSleepTime;

    abstract baseUrl: string;
    abstract countryCode: string;
    abstract languageCode: string;
    abstract salesLine: string;
    abstract shortCode: string;
    abstract thumbnail: string;

    setSleepTimes(minSleepTime: number | undefined, maxSleepTime: number | undefined): void {
        if (minSleepTime) {
            this.minSleepTime = minSleepTime;
        }
        if (maxSleepTime) {
            this.maxSleepTime = maxSleepTime;
        }
    }

    getSleepTime(): number {
        return Math.random() * (this.maxSleepTime - this.minSleepTime) + this.minSleepTime;
    }

    abstract getName(): string;
    abstract getShortName(): string;

    /* eslint-disable @typescript-eslint/indent */
    // eslint-disable-next-line @typescript-eslint/member-ordering
    [key: string]:
        | number
        | string
        | (() => number)
        | (() => string)
        | ((minSleepTime: number | undefined, maxSleepTime: number | undefined) => void)
        | undefined;
    /* eslint-enable @typescript-eslint/indent */
}
