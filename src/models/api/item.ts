import { Availability } from "./availability";
import { Product } from "./product";

export interface Item {
    product: Product;
    price: {
        price: number;
        currency: string;
    };
    availability: Availability;
}
