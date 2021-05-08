import { Item } from "./item";
import { Response } from "./response";

export interface SelectedProductResponse extends Response {
    data?: Item;
}
