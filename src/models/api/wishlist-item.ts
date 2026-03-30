import { CofrProductAggregate } from "./product-aggregate";

export interface WishlistItem {
    id: string;
    updated: Date;
    cofrProductAggregate: CofrProductAggregate;
}
