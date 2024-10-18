import { SftpClient } from "./main.ts";
import { setTimeout } from "node:timers/promises";

const sftpClient = new SftpClient({
    cwd: "playground",
    host: "maya-dev",
    uploaderName: "sftp_1",
});

sftpClient.ls();

await sftpClient.exit();
