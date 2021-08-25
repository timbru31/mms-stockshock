import type { LineItem } from "./line-item";
import type { Response } from "./response";

export interface AddProductResponse extends Response {
    data?: {
        addProduct: {
            id: string;
            lineItems: LineItem[];
        };
    };
}
