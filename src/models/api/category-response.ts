import type { ProductLight } from "./product-light.js";
import type { Response } from "./response.js";

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
