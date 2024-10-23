import type { GenericLogger } from "../../main.ts";

/**
 * A logger that can be turned off via constructor parameter or function.
 * Wraps another GenericLogger or defaults to console
 */
export class SwitchableLogger implements GenericLogger {
    private logger: GenericLogger;

    public isOn: boolean;

    constructor(isOn: boolean = true, logger: GenericLogger = console) {
        this.isOn = isOn;
        this.logger = logger;
    }
    log(message: string, ...metadata: unknown[]): void {
        if (this.isOn) {
            this.logger.log(message, ...metadata);
        }
    }
    info(message: string, ...metadata: unknown[]): void {
        if (this.isOn) {
            this.logger.info(message, ...metadata);
        }
    }
    debug(message: string, ...metadata: unknown[]): void {
        if (this.isOn) {
            this.logger.debug(message, ...metadata);
        }
    }
    warn(message: string, ...metadata: unknown[]): void {
        if (this.isOn) {
            this.logger.warn(message, ...metadata);
        }
    }
    error(message: string, ...metadata: unknown[]): void {
        if (this.isOn) {
            this.logger.error(message, ...metadata);
        }
    }
}
