import colors from "colors/safe";
import { readFile } from "fs/promises";
import { parse } from "toml";
import { createLogger as createWinstonLogger, format, Logger, transports } from "winston";
import { ConfigModel } from "./models/stores/config-model";

export const GRAPHQL_CLIENT_VERSION = "7.13.0";

export async function sleep<T>(sleepTime: number, returnValue?: T): Promise<T> {
    return new Promise<T>((resolve) => setTimeout(() => resolve(returnValue || ({} as T)), sleepTime));
}

export async function loadConfig(logger: Logger): Promise<ConfigModel | null> {
    const configFile = await readFile("stores.toml", "utf-8");
    let config: ConfigModel | null = null;
    try {
        config = parse(configFile);
    } catch (e) {
        logger.error("Uh oh! Unable to parse the config file!");
        logger.error(e);
    }
    return config;
}

export function createLogger(): Logger {
    const customLogFormat = format.printf((info) => {
        return `${info.timestamp} [${getEmojiForLevel(info.level)}] ${info.level}: ${info.message} `;
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

function getEmojiForLevel(level: string) {
    switch (colors.stripColors(level)) {
        case "info":
            return "🧚";
        case "error":
        default:
            return "⚡️";
    }
}
