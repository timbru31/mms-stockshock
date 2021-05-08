import { Availability } from "./availability";

export interface ProductLight {
    productId: string;
    details: {
        title: string;
    };
    availability: Availability;
}
