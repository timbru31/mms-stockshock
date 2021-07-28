export interface Store {
    baseUrl: string;
    countryCode: string;
    languageCode: string;
    salesLine: string;
    shortCode: string;
    loginSleepTime?: number;

    getSleepTime(): number;

    getName(): string;
    getShortName(): string;

    [key: string]: string | number | undefined | (() => number) | (() => string);
}
