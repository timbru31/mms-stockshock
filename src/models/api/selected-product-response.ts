import type { Item } from "./item";
import type { Response } from "./response";

export interface SelectedProductResponse extends Response {
    data?: Item;
}
