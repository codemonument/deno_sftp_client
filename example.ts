import { SftpClient } from "./main.ts";
import { setTimeout } from "node:timers/promises";

try {
    const sftpClient = new SftpClient({
        cwd: "playground",
        host: "maya-dev",
        uploaderName: "sftp_1",
    });

    sftpClient.ls();

    await setTimeout(1000);
    await sftpClient.exit();
} catch (error) {
    console.error(`TEST`, error);
}
