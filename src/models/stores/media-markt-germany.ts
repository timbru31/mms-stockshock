import { Store } from "./store";

export class MediaMarktGermany implements Store {
    baseUrl = "https://www.mediamarkt.de";
    countryCode = "DE";
    salesLine = "Media";

    [key: string]: string;
}
