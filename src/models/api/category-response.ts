import { ProductLight } from "./product-light";
import { Response } from "./response";

export interface CategoryResponse extends Response {
    data?: {
        categoryV4: {
            products: ProductLight[];
            paging: {
                currentPage: number;
                pageCount: number;
            };
        };
    };
}
