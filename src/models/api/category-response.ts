import type { SearchItem } from "./search-item";
import type { Response } from "./response";

export interface CategoryResponse extends Response {
    data?: {
        categoryV4: {
            searchPage: unknown;
            searchParamsStr: string;
            totalProducts: number;
            facets: unknown;
            sortItem: unknown;
            products?: SearchItem[];
            paging: {
                currentPage: number;
                pageCount: number;
            };
            campaigns: unknown;
            meta: unknown;
            decorations: unknown;
            searchResultsAdBeacons: unknown;
            breadcrumbs: {
                categoryId: string;
                wcsId: string;
                name: string;
            }[];
            sponsoredSearch: unknown;
        };
    };
}
