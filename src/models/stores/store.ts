export interface Store {
    baseUrl: string;
    countryCode: string;
    salesLine: string;

    getSleepTime(): number;

    [key: string]: string | number | (() => number);
}
