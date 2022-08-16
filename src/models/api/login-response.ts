import type { Response } from "./response.js";

export interface LoginResponse extends Response {
    data?: {
        loginProfileUser: {
            id: string;
            partyId: number;
            gender: string;
            firstName: string;
            lastName: string;
            birthday: string;
            company: string | null;
            type: string;
            taxId: string | null;
            email: string;
            emailOptIn: boolean;
            loyaltyCustomer: boolean;
            loyaltyCard: string;
            preferredPaymentType: string;
        };
        session: {
            personalizationId: string;
            sessionId: string;
            userid: string;
        };
    };
}
