export interface Store {
    baseUrl: string;
    countryCode: string;
    languageCode: string;
    salesLine: string;
    shortCode: string;
    loginSleepTime?: number;

    getSleepTime(): number;
    setSleepTimes(minSleepTime: undefined | number, maxSleepTime: undefined | number): void;

    getName(): string;
    getShortName(): string;

    [key: string]:
        | string
        | number
        | undefined
        | (() => number)
        | (() => string)
        | ((minSleepTime: undefined | number, maxSleepTime: undefined | number) => void);
}
