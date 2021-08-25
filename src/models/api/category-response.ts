import type { ProductLight } from "./product-light";
import type { Response } from "./response";

export interface CategoryResponse extends Response {
    data?: {
        categoryV4: {
            products?: ProductLight[];
            paging: {
                currentPage: number;
                pageCount: number;
            };
        };
    };
}
