export type FulfillmentMethod = "DELIVERY" | "PICKUP" | "PACKSTATION" | "SHIP_FROM_OUTLET";

export interface Fulfillment {
    method: FulfillmentMethod;
    amount: {
        currency: string;
        price: number;
    };
    promise: {
        earliest: string;
        latest: string;
    };
    selected: boolean;
    hasScheduledAvailability: boolean;
}
