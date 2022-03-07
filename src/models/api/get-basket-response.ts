import type { Fulfillment } from "./fulfillment";
import type { LineItem } from "./line-item";
import type { Response } from "./response";

export interface GetBasketResponse extends Response {
    data?: {
        basket: {
            id: string;
            content: {
                checkout: {
                    mms: {
                        lineItems: LineItem[];
                        fulfillments: Fulfillment[];
                    } | null;
                    mp: unknown[];
                    addresses: {
                        additionalInfo: unknown;
                        city: string;
                        country: string;
                        firstname: string;
                        gender: string;
                        houseNumber: string;
                        id: string;
                        lastname: string;
                        phoneNumber: string | null;
                        preferredBilling: boolean;
                        preferredShipping: boolean;
                        selected: {
                            billing: boolean;
                            packstation: boolean;
                            shipping: boolean;
                        };
                        street: string;
                        type: string;
                        zipcode: string;
                    }[];
                };
                customer: {
                    birthdate: string;
                    companyName: string | null;
                    companyTaxId: string | null;
                    customerTaxId: string | null;
                    businessRelationship: string;
                    email: string;
                    firstName: string;
                    lastName: string;
                    loyaltyCardId: string;
                    loyaltyLevel: string | null;
                    phoneNumber: string | null;
                    type: string;
                    emailOptIn: false;
                    gender: string;
                    loggedIn: true;
                };
            };
            payment: {
                amountPaid: {
                    currency: string;
                    price: number;
                };
                amountToPay: {
                    currency: string;
                    price: number;
                };
                amountToPayExcludingGiftcards: {
                    currency: string;
                    price: number;
                };
                amountToReturn: {
                    currency: string;
                    price: number;
                };
                storedPaymentMethods: unknown[];
                paymentId: unknown;
            };

            coupons: unknown[];
            isLoadTest: boolean;
            state: string;
            paymentStatus: string;
        };
    };
}
