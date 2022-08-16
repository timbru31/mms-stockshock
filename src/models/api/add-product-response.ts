import type { LineItem } from "./line-item.js";
import type { Response } from "./response.js";

export interface AddProductResponse extends Response {
    data?: {
        addProduct: {
            id: string;
            lineItems: LineItem[];
        };
    };
}
