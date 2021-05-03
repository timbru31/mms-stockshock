export interface Store {
    baseUrl: string;
    countryCode: string;
    salesLine: string;
    loginSleepTime?: number;

    getSleepTime(): number;

    [key: string]: string | number | undefined | (() => number);
}
