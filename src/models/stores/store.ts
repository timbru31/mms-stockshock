export interface Store {
    baseUrl: string;
    countryCode: string;
    salesLine: string;
    loginSleepTime?: number;

    getSleepTime(): number;

    getName(): string;

    [key: string]: string | number | undefined | (() => number) | (() => string);
}
