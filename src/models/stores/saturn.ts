import { Store } from "./store";

export class Saturn implements Store {
    baseUrl = "https://www.saturn.de";
    countryCode = "DE";
    salesLine = "Saturn";

    [key: string]: string;
}
