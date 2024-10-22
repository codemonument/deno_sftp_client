/**
 * This module provides a simple adapter to the SFTP client cli.
 * It's not a complete wrapper right now, but it provides the basic functionality to interact with the SFTP client.
 *
 * > [!IMPORTANT]
 * > This module does not handle any SSH config right now. You need to have the host you want to use in your SSH config setup on your machine.
 * > Example: my-host should be a valid host in your SSH config, complete with authorization information (in the example: 'maya-dev').
 *
 * @example
 * ```ts
 * import { SftpClient } from "@codemonument/sftp-client";
 *
 * const sftpClient = new SftpClient({
 *    cwd: "playground",
 *    host: "maya-dev",
 *    uploaderName: "sftp_1",
 * });
 *
 * await sftpClient.ls();
 *
 * await sftpClient.close();
 * ```
 *
 * @module
 */

export { type GenericLogger } from "./src/GenericLogger.type.ts";

export { SftpClient } from "./src/with_execa/SftpClient.ts";
