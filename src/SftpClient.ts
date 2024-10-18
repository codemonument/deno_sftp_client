import {
    bytesToString,
    filter,
    simpleCallbackTarget,
    stringToLines,
} from "@codemonument/rx-webstreams";
import { execa, ResultPromise } from "execa";
import { Readable } from "node:stream";
import type { GenericLogger } from "./GenericLogger.type.ts";

/**
 * The options for instantiating a new SftpClient.
 */
export type ClientOptions = {
    /**
     * The sftp host to connect to. This should be the alias of the host in your ~/.ssh/config file.
     * Note: You should configure all your ssh connection details in your ~/.ssh/config file.
     * I've set up `my-alias`, so that I can simply pass { host: 'my-alias' } to the constructor.
     * Your configuration is correct, when you can connect to the server manually via `sftp my-alias`.
     */
    host: string;

    /**
     * The local working directory where the sftp cli is initialized.
     * (You can later navigate locally or remotely with the `sftp lcd` and `sftp cd` commands.)
     */
    cwd: string;

    /**
     * An identifier for the uploader. This is used for logging.
     * This class is intended to be used with multiple instances in parallel.
     *
     * @example "SFTP1"
     */
    uploaderName: string;

    logger?: GenericLogger;
};

export class SftpClient {
    public uploaderName = "SftpClient";

    private logger: GenericLogger;
    private client: ResultPromise;
    private clientOut: ReadableStream<string>;

    constructor({ cwd, host, uploaderName, logger }: ClientOptions) {
        this.uploaderName = uploaderName;
        this.logger = logger ?? console;

        this.client = execa({
            all: true,
            stdout: ["pipe", "inherit"],
            stderr: ["pipe", "inherit"],
            cwd, // specify a working directory
        })`sftp ${host}`;

        // Detect to the exit of the child process
        this.client.then((result) => {
            console.log(
                `SFTP Connection exited with code ${result.exitCode}`,
                result,
            );
        });

        if (!this.client.all) {
            throw new Error(
                "SftpClient.client.all stream not available - DEV ERROR!",
            );
        }

        const clientOutUint8 = Readable.toWeb(
            this.client.all,
        ) as ReadableStream<
            Uint8Array
        >;
        this.clientOut = clientOutUint8
            .pipeThrough(bytesToString())
            .pipeThrough(stringToLines())
            .pipeThrough(filter((line: string) => line.trim() !== ""));

        this.clientOut.pipeTo(
            simpleCallbackTarget((line) => {
                // split line at spaces
                const parts = line.split(" ");

                switch (parts[0]) {
                    case "Connected": {
                        this.logger.info(
                            `${uploaderName}: connected to ${host}`,
                        );
                        break;
                    }
                    default: {
                        // some other unrecognized stdout/stderr line
                        this.logger.log("SFTP out: ", line);
                        break;
                    }
                }
            }),
        );
    }

    public kill() {
        return this.client.kill();
    }
}
