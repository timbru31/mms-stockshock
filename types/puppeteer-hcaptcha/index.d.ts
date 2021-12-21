declare module "puppeteer-hcaptcha" {
    import type { Page } from "puppeteer";

    export function hcaptcha(page: Page): Promise<void>;
}
