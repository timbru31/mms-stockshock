import { Item } from "./item";
import { Response } from "./response";

export interface WishlistReponse extends Response {
    data?: {
        wishlistItems: {
            total: number;
            items: Item[];
        };
    };
}
