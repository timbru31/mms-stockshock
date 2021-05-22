import { LineItem } from "./line-item";
import { Response } from "./response";

export interface AddProdoductResponse extends Response {
    data?: {
        addProduct: {
            id: string;
            lineItems: LineItem[];
        };
    };
}
