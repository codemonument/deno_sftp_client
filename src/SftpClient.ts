import {
    bytesToString,
    filter,
    simpleCallbackTarget,
    stringToLines,
} from "@codemonument/rx-webstreams";
import { execa, type ResultPromise } from "execa";
import { Readable } from "node:stream";
import pDefer, { type DeferredPromise } from "p-defer";
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

/**
 * This type is used to detect the completion of an up or download
 */
export type FileTransferInProgress =
    | {
        /**
         * The type of the transfer. Either "upload" or "download".
         */
        transferType: "upload";

        /**
         * The local path of the file that is being transfered.
         */
        localPath: string;

        /**
         * The remote path of the file that is being transfered.
         * Optional, because the remote path can be omitted in the sftp put command.
         * In this case, the file will be uploaded to the current remote directory.
         */
        remotePath?: string;

        /**
         * The sftp command which was used to start the file transfer.
         */
        command: string;

        /**
         * A deferred promise which is used to resolve one file transfer.
         * Flow:
         * 1. The file transfer is started => Deferred promise is created
         * 2. The promise part of this DeferredPromise object is awaited by some part of the program
         * 3. The file transfer is completed
         *    => The promise is resolved
         *    => The part waiting for the completion of the promise is notified of the completion of the transfer
         */
        pending: DeferredPromise<boolean>;
    }
    | {
        transferType: "download";

        /**
         * The local path of the file that is being transfered.
         * Optional, because the local path can be omitted in the sftp `get` command.
         * In this case, the file will be downloaded to the current local directory.
         */
        localPath?: string;

        /**
         * The remote path of the file that is being transfered.
         */
        remotePath: string;

        /**
         * The sftp command which was used to start the file transfer.
         */
        command: string;

        /**
         * A deferred promise which is used to resolve one file transfer.
         * Flow:
         * 1. The file transfer is started => Deferred promise is created
         * 2. The promise part of this DeferredPromise object is awaited by some part of the program
         * 3. The file transfer is completed
         *    => The promise is resolved
         *    => The part waiting for the completion of the promise is notified of the completion of the transfer
         */
        pending: DeferredPromise<boolean>;
    };

export class SftpClient {
    public uploaderName = "SftpClient";

    private logger: GenericLogger;
    private client: ResultPromise;
    private clientOut: ReadableStream<string>;

    /**
     * Includes all file paths for which an upload is in progress
     * key: local file path
     * value: FileTransferInProgress object
     */
    private uploadInProgress = new Map<string, FileTransferInProgress>();

    // TODO: Implement downloadInProgress later

    constructor({ cwd, host, uploaderName, logger }: ClientOptions) {
        this.uploaderName = uploaderName;
        this.logger = logger ?? console;

        this.client = execa({
            all: true,
            stdout: ["pipe"],
            stderr: ["pipe"],
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
                    case "Uploading": {
                        // detects this line:
                        // Uploading some/local/path/file.ext to some/remote/path/file.ext
                        const [_uploading, localPath, _to, remotePath] = parts;
                        const upload = this.uploadInProgress.get(localPath);
                        if (!upload) {
                            this.logger.error(
                                `${uploaderName}: STATE_MISSMATCH: internal sftp cli announced an upload", but the FileTransferInProgress state was not found!`,
                                { localPath, remotePath },
                            );
                            return;
                        }
                        this.logger.info(
                            `${uploaderName}: Uploaded ${localPath} to ${remotePath}`,
                        );
                        upload.pending.resolve(true);
                        break;
                    }
                    case "sftp>": {
                        // prompt line
                        const [_prompt, action, ...rest] = parts;
                        const sftpCommand = `${action} ${rest.join(" ")}`;
                        switch (action) {
                            case "put":
                                // this is the upload prompt
                                this.logger.log(
                                    `${uploaderName}: `,
                                    sftpCommand,
                                );
                                break;
                            case "cd":
                                // this is initial cd prompt + evtl. other cd prompts
                                this.logger.log(
                                    `${uploaderName}: `,
                                    sftpCommand,
                                );
                                break;
                            default:
                                this.logger.log(
                                    `${uploaderName}:`,
                                    sftpCommand,
                                );
                        }
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

    /**
     * @param localPath required - the local path of the file to upload
     * @param remotePath optional - if not provided, the file will be uploaded to the current remote directory
     */
    private prepareFileUploadCommand(localPath: string, remotePath?: string) {
        let command = `put ${localPath}`;
        if (remotePath) {
            command += ` ${remotePath}`;
        }

        const uploadInProgress = {
            transferType: "upload",
            localPath,
            remotePath: remotePath ?? undefined,
            pending: pDefer<boolean>(),
            command,
        } satisfies FileTransferInProgress;

        this.uploadInProgress.set(localPath, uploadInProgress);

        return uploadInProgress;
    }
}
