import type { Availability } from "./availability";

export interface CofrProductAggregate {
    cofrCrossSalesLineFeature: null;
    cofrDeliveryFeature?: {
        delivery?: {
            deliveryStatus:
                | "AVAILABLE_ON_NEXT_DAY"
                | "NOT_AVAILABLE"
                | "AVAILABLE_WITHIN_REASONABLE_TIME_FRAME"
                | "AVAILABLE_OUTSIDE_REASONABLE_TIME_FRAME"
                | "PERMANENTLY_NOT_AVAILABLE";
            displayStatus: "AVAILABLE" | "NOT_AVAILABLE" | "PARTIALLY_AVAILABLE";
            fulfillmentTime?: {
                earliest: string | null;
                latest: string | null;
                validUntil: string | null;
            };
            isDistanceBased: null | boolean;
            isShippedFromStore: null | boolean;
            isZipCodeCheckNeeded: boolean;
        };
        deliveryWithZipCode: null;
        // @deprecated - use productId instead
        id: string;
        isInAssortment: boolean;
        releaseDate: string | null;
        zipCode: string | null;
    };
    cofrCoreFeature?: {
        ean: string;
        // @deprecated - use productId instead
        id: string;
        isLoginRequiredForCheckout: boolean;
        productName: string;
        urlRelative: string;
    };
    cofrOnlineStatusFeature?: Availability;
    cofrMediaAssetsFeature?: {
        productMainImage?: {
            imageId: string;
        };
    };
    cofrPriceFeature?: {
        currency: string;
        // @deprecated - use productId instead
        id: string;
        locale: string;
        price?: {
            amount: number;
            baseAmountFormatted: null;
            shippingCost: number;
        };
        vatRate: number;
    };
    offerId: null;
    productId: string;
}
