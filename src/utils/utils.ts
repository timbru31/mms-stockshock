import colors from "colors/safe";
import { readFile } from "fs/promises";
import { parse } from "toml";
import type { Logger } from "winston";
import { createLogger as createWinstonLogger, format, transports } from "winston";
import type { ConfigModel } from "../models/stores/config-model";

export const GRAPHQL_CLIENT_VERSION = "1.51.0";

function getEmojiForLevel(level: string) {
    switch (colors.stripColors(level)) {
        case "info":
            return "🧚";
        case "error":
        default:
            return "⚡️";
    }
}

export async function sleep<T>(sleepTime: number, returnValue?: T): Promise<T> {
    return new Promise<T>((resolve) =>
        setTimeout(() => {
            resolve(returnValue ?? ({} as T));
        }, sleepTime)
    );
}

export async function loadConfig(logger: Logger): Promise<ConfigModel | null> {
    const configFile = await readFile("stores.toml", "utf-8");
    let config: ConfigModel | null = null;
    try {
        config = parse(configFile) as ConfigModel;
    } catch (e: unknown) {
        logger.error("Uh oh! Unable to parse the config file!");
        logger.error(e);
    }
    return config;
}

export function createLogger(): Logger {
    const customLogFormat = format.printf((info) => {
        return `${info.timestamp as string} [${getEmojiForLevel(info.level)}] ${info.level}: ${info.message} `;
    });

    return createWinstonLogger({
        transports: [
            new transports.File({
                filename: "stockshock.log",
                format: format.combine(
                    format.timestamp({
                        format: "YYYY-MM-DD HH:mm:ss",
                    }),
                    format.errors({ stack: true }),
                    format.splat(),
                    customLogFormat
                ),
            }),
            new transports.Console({
                format: format.combine(
                    format.colorize(),
                    format.timestamp({
                        format: "YYYY-MM-DD HH:mm:ss",
                    }),
                    format.errors({ stack: true }),
                    format.splat(),
                    customLogFormat
                ),
            }),
        ],
    });
}

// see https://stackoverflow.com/a/2450976/1902598
export function shuffle<T>(array: T[]): T[] {
    let currentIndex = array.length;
    let temporaryValue: T;
    let randomIndex: number;
    const breakage = 0;
    const step = 1;

    // While there remain elements to shuffle...
    while (breakage !== currentIndex) {
        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= step;

        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }

    return array;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function noop(): void {}

export async function noopPromise(): Promise<void> {
    return Promise.resolve();
}
