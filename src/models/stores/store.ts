export interface Store {
    baseUrl: string;
    countryCode: string;
    languageCode: string;
    salesLine: string;
    shortCode: string;
    loginSleepTime?: number;
    thumbnail: string;

    getSleepTime: () => number;
    setSleepTimes: (minSleepTime: number | undefined, maxSleepTime: number | undefined) => void;

    getName: () => string;
    getShortName: () => string;

    [key: string]:
        | number
        | string
        | (() => number)
        | (() => string)
        | ((minSleepTime: number | undefined, maxSleepTime: number | undefined) => void)
        | undefined;
}
