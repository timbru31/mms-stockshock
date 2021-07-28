import { Item } from "./item";
import { Response } from "./response";

export interface WishlistResponse extends Response {
    data?: {
        wishlistItems: {
            total: number;
            items: Item[];
        };
    };
}
