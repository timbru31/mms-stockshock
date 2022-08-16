import type { Item } from "./item.js";
import type { Response } from "./response.js";

export interface SelectedProductResponse extends Response {
    data?: Item;
}
