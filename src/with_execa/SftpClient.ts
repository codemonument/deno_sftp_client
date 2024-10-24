import {
    bytesToString,
    filter,
    simpleCallbackTarget,
    stringToLines,
} from "@codemonument/rx-webstreams";
import { execa, type Options, type Result, type ResultPromise } from "execa";
import { Readable, Writable } from "node:stream";
import pDefer, { type DeferredPromise } from "p-defer";
import pMap from "p-map";
import type { GenericLogger } from "../GenericLogger.type.ts";
import { concatMap, from, Observable } from "rxjs";

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

/**
 * The SftpClient class provides a simple adapter to the SFTP client cli.
 * For instantiation - options: see {@link ClientOptions}
 */
export class SftpClient {
    public uploaderName = "SftpClient";

    private logger: GenericLogger;
    private client: ResultPromise;
    private clientOut: ReadableStream<string>;
    private clientIn: WritableStreamDefaultWriter<Uint8Array>;
    private textEncoder = new TextEncoder();

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
            switch (result.exitCode) {
                case 0: {
                    this.logger.info(
                        `${uploaderName}: SFTP Connection exited successfully`,
                    );
                    break;
                }
                default: {
                    this.logger.error(
                        `${uploaderName}: SFTP Connection exited unsuccessful with code ${result.exitCode}`,
                        result,
                    );
                }
            }
        });

        // Setup this.clientIn
        // --------------------
        if (!this.client.stdin) {
            throw new Error(
                "SftpClient.client.stdin stream not available - DEV ERROR!",
            );
        }

        const clientInRaw = Writable.toWeb(
            this.client.stdin,
        ) as WritableStream<Uint8Array>;
        this.clientIn = clientInRaw.getWriter();

        // Setup this.clientOut
        // --------------------
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
                                    `${uploaderName}: ${sftpCommand}`,
                                );
                                break;
                            case "cd":
                                // this is initial cd prompt + evtl. other cd prompts
                                this.logger.log(
                                    `${uploaderName}: ${sftpCommand}`,
                                );
                                break;
                            default:
                                this.logger.log(
                                    `${uploaderName}: ${sftpCommand}`,
                                );
                        }
                        break;
                    }
                    default: {
                        // some other unrecognized stdout/stderr line
                        this.logger.log(`${uploaderName}: -> ${line}`);
                        break;
                    }
                }
            }),
        );
    }

    /**
     * @param sftpCommand The sftp command to send to the sftp cli
     * see here for sftp cli docs: https://www.cs.fsu.edu/~myers/howto/commandLineSSH.html
     */
    public async sendCommand(sftpCommand: string) {
        const encodedCommand = this.textEncoder.encode(sftpCommand + ` \n`);
        await this.clientIn.write(encodedCommand);
    }

    /**
     * TODO: caputre output of the ls command and return as Promise<string[]>
     * @param remotePath optional - if not provided, the current remote directory will be listed
     */
    public async ls(remotePath?: string) {
        if (remotePath) {
            await this.sendCommand(`ls ${remotePath}`);
        } else {
            await this.sendCommand("ls");
        }
    }

    /**
     * TODO: capture output of the lls command and return as Promise<string[]>
     * @param localPath optional - the local path of the file to download
     */
    public async lls(localPath?: string) {
        if (localPath) {
            await this.sendCommand(`lls ${localPath}`);
        } else {
            await this.sendCommand("lls");
        }
    }

    /**
     * @param remotePath required - the remote path to cd into
     */
    public async cd(remotePath: string) {
        await this.sendCommand(`cd ${remotePath}`);
    }

    /**
     * @param localPath required - the local path to locally cd into
     */
    public async lcd(localPath: string) {
        await this.sendCommand(`lcd ${localPath}`);
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

    /**
     * Uploads a file to the remote server.
     * @param localPath The local file to upload
     * @param remotePath optional - the remote path to upload the file to, if undefined: use the remote cwd
     * @returns resolves when the upload is completed
     */
    public async uploadFile(
        localPath: string,
        remotePath?: string,
    ): Promise<boolean> {
        const uploadInProgress = this.prepareFileUploadCommand(
            localPath,
            remotePath,
        );
        await this.sendCommand(uploadInProgress.command);
        return uploadInProgress.pending.promise;
    }

    /**
     * Uploads multiple files to the remote server (serially).
     * @param files The local files to upload
     * @returns A Promise which resolves when all uploads are completed
     */
    public async uploadFiles(files: Iterable<string>): Promise<boolean[]> {
        const result = await pMap(
            files,
            (file: string) => this.uploadFile(file),
            { concurrency: 1 },
        );
        return result;
    }

    /**
     * Uploads multiple files to the remote server (serially).
     * @param files
     * @returns An rxjs observable instead of a promise like in this.uploadFiles
     */
    public uploadFiles$(
        files: Iterable<string>,
    ): Observable<{ file: string; nr: number }> {
        return from(files).pipe(
            concatMap((file, index) => {
                const uploadPromise = this.uploadFile(file).then(() => ({
                    file,
                    nr: index + 1,
                }));
                //convert the promise from uploadFile to an observable (will be flattened by concatMap)
                return from(uploadPromise);
            }),
        );
    }

    /**
     * TODO: add downloadInProgress handling
     * @param remotePath
     * @param localPath
     */
    public async downloadFile(remotePath: string, localPath?: string) {
        let command = `get ${remotePath}`;
        if (localPath) {
            command += ` ${localPath}`;
        }
        await this.sendCommand(command);
    }

    /**
     * Hard kill of the inner sftp client process
     * @returns
     */
    public kill(): boolean {
        return this.client.kill();
    }

    /**
     * @returns The Result object from execa (imlementation detail)
     * @throws Error if the sftp client could not be closed correctly
     */
    public async close(): Promise<Result<Options>> {
        await this.sendCommand("exit");

        try {
            // Allows awaiting the exit of the sftp client from the outside + getting the result
            const result = await this.client;
            return result;
        } catch (error) {
            this.logger.error(
                `${this.uploaderName}: Error while exiting sftp client`,
                error,
            );
            throw error;
        }
    }
}
