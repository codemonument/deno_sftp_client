import { execa, Options, ResultPromise } from "execa";

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
};

export class SftpClient {
    public uploaderName = "SftpClient";
    private client: ResultPromise;

    constructor({ cwd, host, uploaderName }: ClientOptions) {
        this.uploaderName = uploaderName;

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
    }

    public kill() {
        return this.client.kill();
    }
}
