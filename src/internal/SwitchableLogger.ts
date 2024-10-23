import type { GenericLogger } from "../../main.ts";

/**
 * A logger that can be turned off via constructor parameter or function.
 * Wraps another GenericLogger or defaults to console
 */
export class SwitchableLogger implements GenericLogger {
    private logger: GenericLogger;

    public logMode: "normal" | "verbose" | "silent";

    constructor(
        logMode: "normal" | "verbose" | "silent" = "normal",
        logger: GenericLogger = console,
    ) {
        this.logMode = logMode;
        this.logger = logger;
    }
    log(message: string, ...metadata: unknown[]): void {
        if (this.logMode === "normal" || this.logMode === "verbose") {
            this.logger.log(message, ...metadata);
        }
    }
    info(message: string, ...metadata: unknown[]): void {
        if (this.logMode === "normal" || this.logMode === "verbose") {
            this.logger.info(message, ...metadata);
        }
    }
    debug(message: string, ...metadata: unknown[]): void {
        if (this.logMode === "verbose") {
            this.logger.debug(message, ...metadata);
        }
    }
    warn(message: string, ...metadata: unknown[]): void {
        if (this.logMode === "normal" || this.logMode === "verbose") {
            this.logger.warn(message, ...metadata);
        }
    }
    error(message: string, ...metadata: unknown[]): void {
        if (this.logMode === "normal" || this.logMode === "verbose") {
            this.logger.error(message, ...metadata);
        }
    }
}
