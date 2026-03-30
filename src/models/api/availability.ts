export interface Availability {
    id: string;
    isAvailableAndBuyable: boolean;
    isAvailableForDelivery: boolean;
    isAvailableForPickup: boolean;
    isInAssortment: boolean;
    onlineStatus: "AVAILABLE" | "TEMPORARILY_NOT_AVAILABLE" | "MP_OFFER" | "PERMANENTLY_NOT_AVAILABLE";
    releaseDate: null | string;
}
