import { LineItem } from "./line-item";
import { Response } from "./response";

export interface AddProductResponse extends Response {
    data?: {
        addProduct: {
            id: string;
            lineItems: LineItem[];
        };
    };
}
