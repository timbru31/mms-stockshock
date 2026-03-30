import type { Item } from "./product-aggregate";
import type { Response } from "./response";

export interface SelectedProductResponse extends Response {
    data?: Item;
}
