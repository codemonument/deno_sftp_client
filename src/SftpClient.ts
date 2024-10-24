import { PuppetProcess } from "@codemonument/puppet-process/deno";
import {
    filter,
    simpleCallbackTarget,
    stringToLines,
} from "@codemonument/rx-webstreams";
import pDefer, { type DeferredPromise } from "p-defer";
import pMap from "p-map";
import { concatMap, from, Observable } from "rxjs";
import { match, P } from "ts-pattern";
import type { GenericLogger } from "./GenericLogger.type.ts";
import { SwitchableLogger } from "./internal/SwitchableLogger.ts";

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

    /**
     * Can be used to pass in a custom logger.
     * Default: console
     */
    logger?: GenericLogger;

    /**
     * Levels:
     *   Normal logs anything which is an `info` or `log` level log or above (`warn`, `error`).
     *   Verbose logs everything.
     *   Silent logs nothing.
     *   Only-unknown logs only logs messages from sftp output, which are not known to this SftpClient wrapper class, so that not implemented functionality can be detected
     */
    logMode?:
        | "normal"
        | "verbose"
        | "silent"
        | "only-unknown"
        | "unknown-and-error";
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
    private logger: SwitchableLogger;
    private client: PuppetProcess;
    private clientOut: ReadableStream<string>;
    private clientIn: WritableStreamDefaultWriter<string>;

    // Commands in Progress Handling
    private inProgress: {
        pwd?: { pending: DeferredPromise<string> };
        cd?: {
            remotePath: string;
            pending: DeferredPromise<void>;
        };
        [key: string]: {
            pending: DeferredPromise<unknown>;
        } | undefined;
    } = {};

    /**
     * Includes all file paths for which an upload is in progress
     * key: local file path
     * value: FileTransferInProgress object
     */
    private uploadInProgress = new Map<string, FileTransferInProgress>();

    /**
     * Includes all remote dir paths for which a mkdir is in progress
     */
    private mkdirInProgress = new Map<string, DeferredPromise<boolean>>();

    // TODO: Implement downloadInProgress later

    // Public Properties
    public uploaderName = "SftpClient";
    public readonly connected: Promise<boolean>;

    constructor(
        {
            cwd,
            host,
            uploaderName,
            logger: genericLogger = console,
            logMode = "normal",
        }: ClientOptions,
    ) {
        this.uploaderName = uploaderName;

        // Setup logMode
        if (logMode === "unknown-and-error") {
            this.logger = new SwitchableLogger(
                "error",
                genericLogger,
            );
        } else if (logMode === "only-unknown") {
            this.logger = new SwitchableLogger(
                "silent",
                genericLogger,
            );
        } else {
            this.logger = new SwitchableLogger(
                logMode,
                genericLogger,
            );
        }

        // Setup the PuppetProcess
        this.client = new PuppetProcess({
            command: `sftp ${host}`,
            logger: this.logger,
            cwd, // specify a working directory
        });

        // Setup public "connected"-Promise
        const connectedDeferred = pDefer<boolean>();
        this.connected = connectedDeferred.promise;

        // Setup this.clientIn
        // --------------------
        this.clientIn = this.client.std_in.getWriter();

        // Setup this.clientOut
        // --------------------
        const clientOutRaw = this.client.std_all;

        this.clientOut = clientOutRaw
            .pipeThrough(stringToLines())
            .pipeThrough(filter((line: string) => line.trim() !== ""));

        // capture and interpret output of the sftp cli
        this.clientOut.pipeTo(
            simpleCallbackTarget((line) => {
                this.logger.debug(`${uploaderName}: rawOut: ${line}`);

                // use ts-pattern to match over the output line string
                // String based matching patterns: https://github.com/gvergnaud/ts-pattern?tab=readme-ov-file#pstring-predicates
                match(line)
                    .with(P.string.startsWith("Connected"), () => {
                        connectedDeferred.resolve(true);
                        this.logger.info(
                            `${uploaderName}: connected to ${host}`,
                        );
                    })
                    .with(
                        // detects this line:
                        // Uploading some/local/path/file.ext to some/remote/path/file.ext
                        P.string.startsWith("Uploading "),
                        () => {
                            const [_uploading, localPath, _to, remotePath] =
                                line;
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
                        },
                    )
                    .with(
                        // detects this line: Remote working directory: /home/tt-bj2
                        // => is the answer to the pwd command
                        P.string.startsWith("Remote working directory:"),
                        () => {
                            const [_part1, remotePath] = line.split(":");
                            this.resolveInProgress("pwd", remotePath.trim());
                        },
                    )
                    .with(
                        // Failure answer to the `cd` command
                        // detects: "-bash: cd: playground: No such file or directory"
                        P.string.startsWith("-bash: cd:"),
                        () => {
                            const [_bash, _cd, remotePath, reason] = line.split(
                                ":",
                            );
                            this.rejectInProgress(
                                "cd",
                                `cd into '${remotePath.trim()}' failed: ${reason.trim()}`,
                            );
                        },
                    )
                    .with(
                        // Another failure answer to the `cd` command
                        // detects: "stat remote: No such file or directory"
                        P.string.startsWith(`stat remote:`),
                        () => {
                            const [_prefix, reason] = line.split(
                                ":",
                            );
                            const cdCommand = this.inProgress.cd;
                            this.rejectInProgress(
                                "cd",
                                `cd into '${cdCommand?.remotePath}' failed: ${reason.trim()}`,
                            );
                        },
                    )
                    .with(P.string.startsWith("sftp>"), () => {
                        // resolve all commands, which do not return anything in case of success
                        // ----------------------------------------------------------------------
                        if (this.inProgress.cd) {
                            this.resolveInProgress("cd", undefined);
                        }

                        // prompt line
                        // const [_prompt, action, ...rest] = line.split(" ");
                        // const sftpCommand = `${action} ${rest.join(" ")}`;
                        // action can be switched over the sftp commands, like put, cd, etc.
                        // switch (action) {
                        // "cd": {}
                        // "pwd": {}
                        // }
                    })
                    .otherwise(() => {
                        // some other unrecognized stdout/stderr line
                        if (logMode === "only-unknown") {
                            this.logger.logMode = "normal";
                            this.logger.log(`${uploaderName}: -> ${line}`);
                            this.logger.logMode = "silent";
                        } else if (logMode === "unknown-and-error") {
                            this.logger.logMode = "normal";
                            this.logger.log(`${uploaderName}: -> ${line}`);
                            this.logger.logMode = "error";
                        } else {
                            // pure silent log mode will be handled by the logger itself
                            this.logger.log(`${uploaderName}: -> ${line}`);
                        }
                    });
            }),
        );

        // start the sftp client process
        this.client.start();

        // detect exit
        this.client.waitForExit().then(() => {
            this.logger.info(
                `${uploaderName}: SFTP Connection exited successfully`,
            );
        }).catch((error) => {
            this.logger.error(
                `${uploaderName}: SFTP Connection exited unsuccessful`,
                error,
            );
        });
    }

    /**
     * @param sftpCommand The sftp command to send to the sftp cli
     * see here for sftp cli docs: https://www.cs.fsu.edu/~myers/howto/commandLineSSH.html
     * To see a full list of SFTP commands and their formats, you can type help when you are logged in via sftp, and it will give you a list of available commands.
     */
    public sendCommand(sftpCommand: string): Promise<void> {
        return this.clientIn.write(`${sftpCommand}\n`);
    }

    /**
     * Get the remote working directory
     */
    public async pwd(): Promise<string> {
        this.inProgress.pwd = {
            pending: pDefer<string>(),
        };
        await this.sendCommand("pwd");
        return this.inProgress.pwd.pending.promise;
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
    public async cd(remotePath: string): Promise<void> {
        this.inProgress.cd = {
            remotePath,
            pending: pDefer<void>(),
        };
        await this.sendCommand(`cd ${remotePath}`);
        return this.inProgress.cd.pending.promise;
    }

    /**
     * @param localPath required - the local path to locally cd into
     */
    public async lcd(localPath: string) {
        await this.sendCommand(`lcd ${localPath}`);
    }

    /**
     * Shows the help menu of the sftp cli with explanations for each command and format
     */
    public async help() {
        await this.sendCommand(`help`);
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
    public async kill(): Promise<void> {
        // close input stream before killing
        await this.clientIn.close();
        await this.client.kill();
    }

    /**
     * @returns A promise that resolves when the client could be closed correctly
     * @throws Error if the sftp client could not be closed correctly
     */
    public async close(): Promise<void> {
        await this.sendCommand("exit");

        // close input stream before exiting
        await this.clientIn.close();

        try {
            await this.client.waitForExit();
        } catch (error) {
            this.logger.error(
                `${this.uploaderName}: Error while exiting sftp client`,
                error,
            );
            throw error;
        }
    }

    private resolveInProgress(
        command: string, // the command which was sent to the sftp cli (without args, like 'cd' or 'pwd)
        value: unknown,
    ) {
        const lastCommand = this.inProgress[command];

        // this.logger.debug(
        //     `Resolving in progress command '${command}' with value '${value}'`,
        // );

        if (!lastCommand) {
            this.logger.error(
                `DEV ERROR (should not happen in prod - make issue in github):
                 this.inProgress['${command}'] is not set, but it should resolve in this function! - Logging the resolved value instead!
                 Logging it as 'info' level, you might not see it, depending on your logMode given in constructor! 
                 Default logMode is 'normal'.`,
            );
            this.logger.info(`${command}: ${value}`);
            return;
        }

        lastCommand.pending.resolve(value);
    }
    private rejectInProgress(
        command: string, // the command which was sent to the sftp cli (without args, like 'cd' or 'pwd)
        errorMessage: string,
    ) {
        const lastCommand = this.inProgress[command];

        if (!lastCommand) {
            this.logger.error(
                `DEV ERROR (should not happen in prod - make issue in github):
                 this.lastNoOutputCommand is not set, but an error occurred for such command! - Logging the error instead!`,
            );
            this.logger.error(errorMessage);
            return;
        }

        lastCommand.pending.reject(errorMessage);
    }
}
