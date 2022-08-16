import type { Availability } from "./availability.js";

export interface ProductLight {
    productId: string;
    details: {
        title: string;
    };
    availability: Availability;
}
