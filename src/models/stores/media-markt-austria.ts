import { Store } from "./store";

export class MediaMarktAustria implements Store {
    baseUrl = "https://www.mediamarkt.at";
    countryCode = "AT";
    salesLine = "Media";

    [key: string]: string;
}
