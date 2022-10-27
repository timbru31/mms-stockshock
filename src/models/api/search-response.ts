import type { Response } from "./response";
import type { SearchItem } from "./search-item";

export interface SearchResponse extends Response {
    data?: {
        searchV4: {
            searchPage: unknown;
            searchParamsStr: string;
            totalProducts: number;
            products?: SearchItem[];
            facets: unknown;
            sortItem: unknown;
            paging: {
                currentPage: number;
                pageCount: number;
            };
            meta: unknown;
            decorations: unknown;
            searchResultsAdBeacons: unknown;
        };
    };
}
