export type GenericLogger = {
    /**
     * Logs a message.
     * @param message The message to log.
     */
    log(message: string, ...metadata: unknown[]): void;
    info(message: string, ...metadata: unknown[]): void;
    debug(message: string, ...metadata: unknown[]): void;
    warn(message: string, ...metadata: unknown[]): void;
    error(message: string, ...metadata: unknown[]): void;
};
