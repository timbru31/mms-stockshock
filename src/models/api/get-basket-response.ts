import { Fulfillment } from "./fulfillment";
import { LineItem } from "./line-item";
import { Response } from "./response";

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
                        additionalInfo: null | unknown;
                        city: string;
                        country: string;
                        firstname: string;
                        gender: string;
                        houseNumber: string;
                        id: string;
                        lastname: string;
                        phoneNumber: null | string;
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
                    companyName: null | string;
                    companyTaxId: null | string;
                    customerTaxId: null | string;
                    businessRelationship: string;
                    email: string;
                    firstName: string;
                    lastName: string;
                    loyaltyCardId: string;
                    loyaltyLevel: null | string;
                    phoneNumber: null | string;
                    type: string;
                    emailOptIn: false;
                    gender: string;
                    loggedIn: true;
                };
            };
            payment: {
                amountPaid: {
                    currency: string;
                    price: 0;
                };
                amountToPay: {
                    currency: string;
                    price: 0;
                };
                amountToPayExcludingGiftcards: {
                    currency: string;
                    price: 0;
                };
                amountToReturn: {
                    currency: string;
                    price: 0;
                };
                storedPaymentMethods: unknown[];
                paymentId: null | unknown;
            };

            coupons: unknown[];
            isLoadTest: boolean;
            state: string;
            paymentStatus: string;
        };
    };
}
